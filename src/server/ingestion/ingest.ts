import 'server-only';
import Papa from 'papaparse';
import { Prisma, type DatasetType, type MovementReason } from '@prisma/client';
import { prisma } from '@/server/db/client';
import {
  parseProducts,
  parseCustomers,
  parseBatches,
  parseOrders,
  parseInventory,
  parsePurchases,
  parseCapital,
  type ImportDataset,
  type RowError,
  type IngestSummary,
} from './parsers';
import { toMinor } from '@/lib/money';

const DATASET_TYPE: Record<ImportDataset, DatasetType> = {
  products: 'PRODUCTS',
  customers: 'CUSTOMERS',
  orders: 'ORDERS',
  batches: 'BATCHES',
  inventory: 'INVENTORY',
  purchases: 'EXPENSES',
  capital: 'CAPITAL',
};

function csvToRows(csvText: string): Record<string, string>[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return parsed.data;
}

async function defaultBranchId(uploaderBranchId: string | null): Promise<string | null> {
  if (uploaderBranchId) return uploaderBranchId;
  const b = await prisma.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  return b?.id ?? null;
}

export async function ingestCsv(
  dataset: ImportDataset,
  csvText: string,
  opts: { userId: string | null; branchId: string | null; fileName: string },
): Promise<IngestSummary> {
  const rows = csvToRows(csvText);
  const upload = await prisma.uploadBatch.create({
    data: {
      dataset: DATASET_TYPE[dataset],
      fileName: opts.fileName,
      uploadedById: opts.userId,
      status: 'PROCESSING',
      rowsTotal: rows.length,
    },
  });

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: RowError[] = [];

  try {
    if (dataset === 'products') {
      const { valid, errors: e } = parseProducts(rows);
      errors.push(...e);
      for (const p of valid) {
        const { sku, ...rest } = p;
        const existing = await prisma.product.findUnique({ where: { sku }, select: { id: true } });
        if (existing) {
          await prisma.product.update({ where: { sku }, data: rest });
          updated += 1;
        } else {
          await prisma.product.create({ data: { sku, ...rest } });
          inserted += 1;
        }
      }
    } else if (dataset === 'customers') {
      const { valid, errors: e } = parseCustomers(rows);
      errors.push(...e);
      for (const c of valid) {
        const { externalId, ...rest } = c;
        const existing = await prisma.customer.findUnique({ where: { externalId }, select: { id: true } });
        if (existing) {
          await prisma.customer.update({ where: { externalId }, data: rest });
          updated += 1;
        } else {
          await prisma.customer.create({ data: { externalId, ...rest } });
          inserted += 1;
        }
      }
    } else if (dataset === 'batches') {
      const branchId = await defaultBranchId(opts.branchId);
      const { valid, errors: e } = parseBatches(rows);
      errors.push(...e);
      for (const b of valid) {
        const { batchNumber, ...rest } = b;
        const data = { ...rest, branchId, uploadBatchId: upload.id };
        const existing = await prisma.roastBatch.findUnique({
          where: { batchNumber },
          select: { id: true },
        });
        if (existing) {
          await prisma.roastBatch.update({ where: { batchNumber }, data });
          updated += 1;
        } else {
          await prisma.roastBatch.create({ data: { batchNumber, ...data } });
          inserted += 1;
        }
      }
    } else if (dataset === 'inventory') {
      const branchId = await defaultBranchId(opts.branchId);
      const { valid, errors: e } = parseInventory(rows);
      errors.push(...e);
      const now = new Date();
      for (const it of valid) {
        const existing = await prisma.inventoryItem.findFirst({
          where: { nameAr: it.nameAr, branchId },
          select: { id: true },
        });
        let itemId: string;
        if (existing) {
          await prisma.inventoryItem.update({
            where: { id: existing.id },
            data: { category: it.category, unit: it.unit, nameEn: it.nameEn },
          });
          itemId = existing.id;
          updated += 1;
        } else {
          const created = await prisma.inventoryItem.create({
            data: { category: it.category, nameEn: it.nameEn, nameAr: it.nameAr, unit: it.unit, branchId },
          });
          itemId = created.id;
          inserted += 1;
        }
        // Opening / additions / deductions become signed stock movements. A
        // deterministic externalId per item+type keeps re-uploads idempotent.
        const moves: [MovementReason, number, string][] = [
          ['OPENING', it.opening, 'OPEN'],
          ['PURCHASE', it.additions, 'ADD'],
          ['ADJUSTMENT', -it.deductions, 'DED'],
        ];
        for (const [reason, qty, tag] of moves) {
          const externalId = `INV-${tag}-${itemId}`;
          await prisma.stockMovement.upsert({
            where: { externalId },
            create: {
              externalId,
              inventoryItemId: itemId,
              occurredAt: now,
              reason,
              quantity: qty,
              branchId,
              uploadBatchId: upload.id,
            },
            update: { quantity: qty, reason },
          });
        }
      }
    } else if (dataset === 'purchases' || dataset === 'capital') {
      // Finance imports: each row becomes a FinanceEntry, auto-creating the
      // supplier/shareholder Party. Idempotent via importKey.
      const partyCache = new Map<string, string>();
      const partyId = async (name: string | undefined, type: 'SUPPLIER' | 'SHAREHOLDER') => {
        const key = name?.trim();
        if (!key) return null;
        const cached = partyCache.get(key);
        if (cached) return cached;
        const found = await prisma.party.findFirst({ where: { name: key }, select: { id: true } });
        const party = found ?? (await prisma.party.create({ data: { name: key, type } }));
        partyCache.set(key, party.id);
        return party.id;
      };

      if (dataset === 'purchases') {
        const { valid, errors: e } = parsePurchases(rows);
        errors.push(...e);
        // A purchases upload fully replaces the previous one (manual entries,
        // which have no importKey, are untouched). Index-based keys can't collide.
        await prisma.financeEntry.deleteMany({ where: { importKey: { startsWith: 'PUR:' } } });
        let i = 0;
        for (const p of valid) {
          await prisma.financeEntry.create({
            data: {
              date: p.date,
              type: 'PURCHASE',
              amount: toMinor(p.amount, p.currency),
              currency: p.currency,
              obligation: false,
              partyId: await partyId(p.supplier, 'SUPPLIER'),
              reference: p.reference ?? null,
              description: p.description,
              importKey: `PUR:${i++}`,
              createdById: opts.userId,
            },
          });
          inserted += 1;
        }
      } else {
        const { valid, errors: e } = parseCapital(rows);
        errors.push(...e);
        await prisma.financeEntry.deleteMany({ where: { importKey: { startsWith: 'CAP:' } } });
        let i = 0;
        for (const c of valid) {
          await prisma.financeEntry.create({
            data: {
              date: c.date,
              type: 'CAPITAL_IN',
              amount: toMinor(c.amount, c.currency),
              currency: c.currency,
              obligation: false,
              partyId: await partyId(c.shareholder, 'SHAREHOLDER'),
              reference: c.reference ?? null,
              description: c.shareholder,
              importKey: `CAP:${i++}`,
              createdById: opts.userId,
            },
          });
          inserted += 1;
        }
      }
    } else {
      // orders
      const branchId = await defaultBranchId(opts.branchId);
      const { valid, errors: e } = parseOrders(rows);
      errors.push(...e);

      for (const order of valid) {
        // resolve customer + products
        const customer = order.customerExternalId
          ? await prisma.customer.findUnique({
              where: { externalId: order.customerExternalId },
              select: { id: true },
            })
          : null;

        const lineData: {
          productId: string;
          sku: string;
          quantity: number;
          unitGrossPrice: number;
          lineDiscount: number;
          lineNet: number;
          unitCogsSnapshot: number;
        }[] = [];
        for (const l of order.lines) {
          const product = await prisma.product.findUnique({
            where: { sku: l.sku },
            select: { id: true, cogsPerUnit: true },
          });
          if (!product) {
            errors.push({ row: 0, message: `${order.orderNumber}: unknown SKU ${l.sku}` });
            continue;
          }
          lineData.push({
            productId: product.id,
            sku: l.sku,
            quantity: l.quantity,
            unitGrossPrice: l.unitGrossPrice,
            lineDiscount: l.lineDiscount,
            lineNet: l.unitGrossPrice * l.quantity - l.lineDiscount,
            unitCogsSnapshot: product.cogsPerUnit,
          });
        }
        if (lineData.length === 0) {
          skipped += 1;
          continue;
        }

        const gross = lineData.reduce((s, l) => s + l.unitGrossPrice * l.quantity, 0);
        const discount = lineData.reduce((s, l) => s + l.lineDiscount, 0);
        const refund = order.status === 'RETURNED' || order.status === 'REFUNDED' ? gross - discount : 0;
        const orderData = {
          placedAt: order.placedAt,
          customerId: customer?.id ?? null,
          branchId,
          channel: order.channel,
          governorate: order.governorate,
          fulfillmentMethod: order.fulfillmentMethod,
          status: order.status,
          grossAmount: gross,
          discountAmount: discount,
          refundAmount: refund,
          deliveryFee: order.deliveryFee,
          deliveryCost: order.deliveryCost,
          uploadBatchId: upload.id,
        };

        await prisma.$transaction(async (tx) => {
          const existing = await tx.order.findUnique({
            where: { orderNumber: order.orderNumber },
            select: { id: true },
          });
          if (existing) {
            await tx.orderLine.deleteMany({ where: { orderId: existing.id } });
            await tx.order.update({ where: { id: existing.id }, data: orderData });
            await tx.orderLine.createMany({ data: lineData.map((l) => ({ ...l, orderId: existing.id })) });
            updated += 1;
          } else {
            const created = await tx.order.create({
              data: { orderNumber: order.orderNumber, ...orderData },
            });
            await tx.orderLine.createMany({ data: lineData.map((l) => ({ ...l, orderId: created.id })) });
            inserted += 1;
          }
        });
      }
    }
  } catch (err) {
    errors.push({ row: 0, message: err instanceof Error ? err.message : 'ingest failed' });
  }

  const status = errors.length > 0 ? (inserted + updated > 0 ? 'PARTIAL' : 'FAILED') : 'COMPLETED';
  await prisma.uploadBatch.update({
    where: { id: upload.id },
    data: {
      status,
      rowsInserted: inserted,
      rowsUpdated: updated,
      rowsSkipped: skipped,
      errorReport: errors.slice(0, 50) as unknown as Prisma.InputJsonValue,
    },
  });
  await prisma.auditLog.create({
    data: {
      userId: opts.userId,
      action: 'IMPORT',
      entity: dataset,
      metadata: { inserted, updated, skipped, errors: errors.length },
    },
  });

  return {
    dataset,
    rowsTotal: rows.length,
    inserted,
    updated,
    skipped,
    errors: errors.slice(0, 50),
    uploadBatchId: upload.id,
  };
}
