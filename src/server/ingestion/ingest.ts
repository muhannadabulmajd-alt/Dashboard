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
  parseShipments,
  type ImportDataset,
  type ProductInput,
  type RowError,
  type IngestSummary,
} from './parsers';
import { toMinor, convertToIqd } from '@/lib/money';
import { getUsdToIqd } from '@/server/settings';

const DATASET_TYPE: Record<ImportDataset, DatasetType> = {
  products: 'PRODUCTS',
  customers: 'CUSTOMERS',
  orders: 'ORDERS',
  batches: 'BATCHES',
  inventory: 'INVENTORY',
  purchases: 'EXPENSES',
  capital: 'CAPITAL',
  shipments: 'SHIPMENTS',
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
      // Resolve (or auto-create) parent product groups referenced by the `group`
      // column, so importing products also builds the variation hierarchy.
      const groupCache = new Map<string, string>();
      let seq = (await prisma.productGroup.findMany({ select: { code: true } })).reduce((m, { code }) => {
        const x = code.match(/^PG-0*(\d+)$/i);
        return x ? Math.max(m, Number(x[1])) : m;
      }, 0);
      const resolveGroup = async (name: string, productLine: ProductInput['productLine']): Promise<string> => {
        const key = name.toLowerCase();
        const cached = groupCache.get(key);
        if (cached) return cached;
        const found = await prisma.productGroup.findFirst({
          where: { OR: [{ code: name }, { nameEn: { equals: name, mode: 'insensitive' } }, { nameAr: name }] },
          select: { id: true },
        });
        const id =
          found?.id ??
          (
            await prisma.productGroup.create({
              data: { code: `PG-${String(++seq).padStart(6, '0')}`, nameEn: name, nameAr: name, productLine },
            })
          ).id;
        groupCache.set(key, id);
        return id;
      };
      for (const p of valid) {
        const { sku, group, ...rest } = p;
        const groupId = group ? await resolveGroup(group, rest.productLine) : undefined;
        const data = groupId ? { ...rest, groupId } : rest;
        const existing = await prisma.product.findUnique({ where: { sku }, select: { id: true } });
        if (existing) {
          await prisma.product.update({ where: { sku }, data });
          updated += 1;
        } else {
          await prisma.product.create({ data: { sku, ...data } });
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
            data: {
              category: it.category,
              unit: it.unit,
              nameEn: it.nameEn,
              unitCost: it.unitCost,
              reorderPoint: it.reorderPoint,
              avgDailyUsage: it.avgDailyUsage,
            },
          });
          itemId = existing.id;
          updated += 1;
        } else {
          const created = await prisma.inventoryItem.create({
            data: {
              category: it.category,
              nameEn: it.nameEn,
              nameAr: it.nameAr,
              unit: it.unit,
              branchId,
              unitCost: it.unitCost,
              reorderPoint: it.reorderPoint,
              avgDailyUsage: it.avgDailyUsage,
            },
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
        const fallbackRate = await getUsdToIqd();
        let i = 0;
        for (const p of valid) {
          // Store every purchase in IQD. A USD purchase is converted at the
          // row's rate (or the configured default), keeping the original.
          const payMinor = toMinor(p.amount, p.currency);
          const usd = p.currency === 'USD';
          const rate = usd ? Math.round(p.rate ?? fallbackRate) : null;
          await prisma.financeEntry.create({
            data: {
              date: p.date,
              type: 'PURCHASE',
              amount: usd ? convertToIqd(payMinor, 'USD', rate as number) : payMinor,
              currency: 'IQD',
              origCurrency: usd ? 'USD' : null,
              origAmount: usd ? payMinor : null,
              fxRate: rate,
              obligation: false,
              partyId: await partyId(p.supplier, 'SUPPLIER'),
              categoryType: p.categoryType ?? null,
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
        const fallbackRate = await getUsdToIqd();
        let i = 0;
        for (const c of valid) {
          // Capital is stored in IQD too; a USD contribution converts at the
          // configured rate (use the entry form for a date-specific rate).
          const payMinor = toMinor(c.amount, c.currency);
          const usd = c.currency === 'USD';
          const rate = usd ? Math.round(fallbackRate) : null;
          await prisma.financeEntry.create({
            data: {
              date: c.date,
              type: 'CAPITAL_IN',
              amount: usd ? convertToIqd(payMinor, 'USD', rate as number) : payMinor,
              currency: 'IQD',
              origCurrency: usd ? 'USD' : null,
              origAmount: usd ? payMinor : null,
              fxRate: rate,
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
    } else if (dataset === 'shipments') {
      // Courier delivery report → one Shipment per order. Matched to our orders
      // by orderNumber; idempotent via the order's unique shipment relation.
      const { valid, errors: e } = parseShipments(rows);
      errors.push(...e);
      for (const s of valid) {
        const order = await prisma.order.findUnique({
          where: { orderNumber: s.orderNumber },
          select: { id: true, governorate: true },
        });
        if (!order) {
          errors.push({ row: 0, message: `unknown order ${s.orderNumber}` });
          skipped += 1;
          continue;
        }
        const data = {
          courier: s.courier ?? 'Courier',
          status: s.status,
          governorate: s.governorate ?? order.governorate,
          shippingCost: s.shippingCost,
          dispatchedAt: s.dispatchedAt ?? null,
          deliveredAt: s.deliveredAt ?? null,
          failureReason: s.failureReason ?? null,
        };
        const existing = await prisma.shipment.findUnique({
          where: { orderId: order.id },
          select: { id: true },
        });
        if (existing) {
          await prisma.shipment.update({ where: { orderId: order.id }, data });
          updated += 1;
        } else {
          await prisma.shipment.create({ data: { orderId: order.id, ...data } });
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
          unitLabel: string;
          unitGrossPrice: number;
          lineDiscount: number;
          lineNet: number;
          unitCogsSnapshot: number;
        }[] = [];
        for (const l of order.lines) {
          const product = await prisma.product.findUnique({
            where: { sku: l.sku },
            select: { id: true, cogsPerUnit: true, sellUnit: true },
          });
          if (!product) {
            errors.push({ row: 0, message: `${order.orderNumber}: unknown SKU ${l.sku}` });
            continue;
          }
          lineData.push({
            productId: product.id,
            sku: l.sku,
            quantity: l.quantity,
            unitLabel: product.sellUnit,
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
          createdById: opts.userId,
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

      // Refresh each customer's order aggregates so CRM metrics (segments,
      // by-city, first/last order) reflect the imported orders.
      const agg = await prisma.order.groupBy({
        by: ['customerId'],
        where: { customerId: { not: null } },
        _count: { _all: true },
        _min: { placedAt: true },
        _max: { placedAt: true },
      });
      for (const a of agg) {
        if (!a.customerId) continue;
        await prisma.customer.update({
          where: { id: a.customerId },
          data: {
            ordersCount: a._count._all,
            firstOrderAt: a._min.placedAt,
            lastOrderAt: a._max.placedAt,
          },
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
