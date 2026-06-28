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
  type PurchaseInput,
  type RowError,
  type IngestSummary,
} from './parsers';
import { toMinor, convertToIqd } from '@/lib/money';
import { getUsdToIqd } from '@/server/settings';
import { syncActiveCost } from '@/server/inventory/fifo';
import { ledgerRecordClassForLines } from '@/lib/ledger-record-class';
import { preflightImport } from './preflight';
import { upsertImportedOrder } from '@/server/orders/import-sync';
import { upsertImportedShipment } from '@/server/shipments/import-sync';
import { upsertImportedRoastBatch } from '@/server/roastery/import-sync';
import { getOrderStatusRoleMap } from '@/server/lists/resolver';
import { generateProductBarcode } from '@/server/records/numbering';

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

function csvToRows(csvText: string): { rows: Record<string, string>[]; errors: RowError[] } {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.replace(/^\uFEFF/, '').trim(),
  });
  return {
    rows: parsed.data.filter((row) => Object.values(row).some((value) => value?.trim())),
    errors: parsed.errors.map((error) => ({
      row: (error.row ?? 0) + 2,
      message: `CSV: ${error.message}`,
    })),
  };
}
type Tx = Prisma.TransactionClient;

async function resolveImportParty(tx: Tx, name: string, type: 'SUPPLIER' | 'SHAREHOLDER'): Promise<string> {
  const key = name.trim();
  const found = await tx.party.findFirst({ where: { name: key }, select: { id: true } });
  return (found ?? await tx.party.create({ data: { name: key, type }, select: { id: true } })).id;
}

async function resolveImportBranch(tx: Tx, code: string): Promise<string> {
  const branch = await tx.branch.findUnique({ where: { code: code.trim().toUpperCase() }, select: { id: true } });
  if (!branch) throw new Error(`unknown branch ${code}`);
  return branch.id;
}

async function resolveImportAccount(tx: Tx, name: string, branchId: string): Promise<{ id: string; type: string }> {
  let account = await tx.financeAccount.findFirst({
    where: { name: { equals: name.trim(), mode: 'insensitive' }, branchId, isActive: true },
    select: { id: true, type: true },
  });
  if (!account && name.trim().toLowerCase() === 'cash on hands') {
    account = await tx.financeAccount.create({
      data: { name: 'Cash on Hands', type: 'CASH', currency: 'IQD', branchId, openingBalance: 0 },
      select: { id: true, type: true },
    });
  }
  if (!account) throw new Error(`unknown payment account ${name}`);
  return account;
}

async function ingestPurchaseRecord(
  tx: Tx,
  purchase: PurchaseInput,
  uploadBatchId: string,
  userId: string | null,
): Promise<{ inserted: boolean; touchedItems: string[] }> {
  const branchId = await resolveImportBranch(tx, purchase.branchCode);
  const account = purchase.paymentMode === 'PAID'
    ? await resolveImportAccount(tx, purchase.paymentAccount, branchId)
    : null;
  const supplierId = await resolveImportParty(tx, purchase.supplier, 'SUPPLIER');
  const existing = await tx.financeEntry.findUnique({
    where: { importKey: purchase.importKey },
    select: { id: true, costLayers: { select: { inventoryItemId: true } } },
  });
  const touchedItems = new Set(existing?.costLayers.map((layer) => layer.inventoryItemId) ?? []);
  if (existing) {
    await tx.fixedAsset.deleteMany({ where: { financeEntryId: existing.id } });
    await tx.inventoryCostLayer.deleteMany({ where: { financeEntryId: existing.id } });
    await tx.stockMovement.deleteMany({ where: { financeEntryId: existing.id } });
    await tx.financeEntry.deleteMany({ where: { settlesId: existing.id } });
    await tx.financeEntry.delete({ where: { id: existing.id } });
  }

  const categories = purchase.lines.map((line) => line.categoryType).filter(Boolean);
  const categoryType = categories.length && categories.every((value) => value === categories[0])
    ? categories[0]
    : null;
  const usd = purchase.sourceCurrency === 'USD' && purchase.sourceAmount != null;
  const entry = await tx.financeEntry.create({
    data: {
      date: purchase.date,
      type: 'PURCHASE',
      recordClass: ledgerRecordClassForLines(purchase.lines),
      amount: purchase.amountIqd,
      currency: 'IQD',
      origCurrency: usd ? 'USD' : null,
      origAmount: usd ? toMinor(purchase.sourceAmount as number, 'USD') : null,
      fxRate: usd ? Math.round(purchase.rate ?? purchase.amountIqd / (purchase.sourceAmount as number)) : null,
      obligation: purchase.paymentMode === 'CREDIT',
      obligationKind: purchase.paymentMode === 'CREDIT' ? 'PAYABLE' : null,
      dueDate: purchase.paymentMode === 'CREDIT' ? purchase.date : null,
      accountId: account?.id ?? null,
      partyId: supplierId,
      categoryType,
      paymentMethod: purchase.paymentMode === 'CREDIT' ? 'CREDIT' : account?.type === 'CASH' ? 'CASH' : 'OTHER',
      description: purchase.description,
      reference: purchase.reference,
      branchId,
      importKey: purchase.importKey,
      createdById: userId,
    },
    select: { id: true },
  });

  for (const line of purchase.lines) {
    const unitCost = (line.lineAmountIqd / line.quantity).toFixed(3);
    let inventoryItemId: string | null = null;
    let lineCategory = line.categoryType ?? null;
    if (line.itemType === 'INVENTORY') {
      const inventoryCategory = line.inventoryCategory;
      if (!inventoryCategory) throw new Error(`${purchase.recordKey}: missing inventory category`);
      const existingItem = await tx.inventoryItem.findFirst({
        where: { nameAr: line.itemName, branchId },
        select: { id: true },
      });
      const item = existingItem
        ? await tx.inventoryItem.update({
            where: { id: existingItem.id },
            data: { category: inventoryCategory, unit: line.unit, isActive: true },
            select: { id: true },
          })
        : await tx.inventoryItem.create({
            data: {
              nameEn: line.itemName,
              nameAr: line.itemName,
              category: inventoryCategory,
              unit: line.unit,
              unitCost,
              branchId,
            },
            select: { id: true },
          });
      inventoryItemId = item.id;
      touchedItems.add(item.id);
      lineCategory = inventoryCategory === 'GREEN_COFFEE'
        ? 'GREEN_COFFEE'
        : inventoryCategory === 'PACKAGING' || inventoryCategory === 'DRIP_BAGS'
          ? 'PACKAGING'
          : null;
      await tx.inventoryCostLayer.create({
        data: {
          inventoryItemId: item.id,
          financeEntryId: entry.id,
          qtyReceived: line.quantity.toFixed(3),
          unitCost,
          receivedAt: purchase.date,
        },
      });
      await tx.stockMovement.create({
        data: {
          inventoryItemId: item.id,
          financeEntryId: entry.id,
          occurredAt: purchase.date,
          reason: 'PURCHASE',
          quantity: line.quantity.toFixed(3),
          reference: purchase.reference,
          externalId: `${purchase.importKey}:${line.lineNo}`,
          branchId,
          uploadBatchId,
        },
      });
    }

    await tx.ledgerEntryLine.create({
      data: {
        financeEntryId: entry.id,
        lineNo: line.lineNo,
        itemType: line.itemType,
        itemName: line.itemName,
        assetKey: line.assetKey ?? null,
        assetCategory: line.assetCategory ?? null,
        categoryType: line.itemType === 'ASSET' ? 'EQUIPMENT' : lineCategory,
        inventoryItemId,
        unit: line.unit,
        quantity: line.quantity.toFixed(3),
        unitCost,
        landedUnitCost: unitCost,
        lineTotal: line.lineAmountIqd,
        branchId,
        notes: line.notes ?? null,
      },
    });
  }

  return { inserted: !existing, touchedItems: [...touchedItems] };
}

async function syncImportedAssets(purchases: PurchaseInput[], userId: string | null): Promise<void> {
  const assetKeys = new Set(
    purchases.flatMap((purchase) => purchase.lines.map((line) => line.assetKey).filter(Boolean) as string[]),
  );

  for (const assetKey of assetKeys) {
    await prisma.$transaction(async (tx) => {
      const lines = await tx.ledgerEntryLine.findMany({
        where: { assetKey, itemType: 'ASSET' },
        include: {
          financeEntry: {
            select: { id: true, date: true, partyId: true, branchId: true, reference: true },
          },
        },
        orderBy: [{ financeEntry: { date: 'asc' } }, { lineNo: 'asc' }],
      });
      if (!lines.length) return;
      const first = lines[0];
      const linked = lines[lines.length - 1].financeEntry;
      const totalCost = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      const quantity = Math.max(...lines.map((line) => Number(line.quantity)));
      const references = lines.map((line) => line.financeEntry.reference).filter(Boolean) as string[];
      await tx.fixedAsset.upsert({
        where: { importKey: `ASSET:HISTORICAL_SPEND:${assetKey}` },
        create: {
          importKey: `ASSET:HISTORICAL_SPEND:${assetKey}`,
          name: first.itemName,
          category: first.assetCategory ?? 'Equipment',
          quantity: quantity.toFixed(3),
          unit: first.unit,
          totalCost,
          unitCost: (totalCost / quantity).toFixed(3),
          purchaseDate: first.financeEntry.date,
          partyId: linked.partyId,
          branchId: linked.branchId,
          financeEntryId: linked.id,
          notes: `Historical purchase references: ${[...new Set(references)].join(', ')}`,
          createdById: userId,
        },
        update: {
          name: first.itemName,
          category: first.assetCategory ?? 'Equipment',
          quantity: quantity.toFixed(3),
          unit: first.unit,
          totalCost,
          unitCost: (totalCost / quantity).toFixed(3),
          purchaseDate: first.financeEntry.date,
          partyId: linked.partyId,
          branchId: linked.branchId,
          financeEntryId: linked.id,
          notes: `Historical purchase references: ${[...new Set(references)].join(', ')}`,
          isActive: true,
          archivedAt: null,
          archivedById: null,
          archiveReason: null,
        },
      });
    }, { timeout: 60_000 });
  }
}

async function defaultBranchId(uploaderBranchId: string | null): Promise<string | null> {
  if (uploaderBranchId) return uploaderBranchId;
  const b = await prisma.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  return b?.id ?? null;
}

export async function ingestCsv(
  dataset: ImportDataset,
  csvText: string,
  opts: { userId: string | null; branchId: string | null; fileName: string; dryRun?: boolean },
): Promise<IngestSummary> {
  const csv = csvToRows(csvText);
  const rows = csv.rows;
  const preflightErrors = [...csv.errors, ...await preflightImport(dataset, rows)];
  if (opts.dryRun) {
    return {
      dataset,
      rowsTotal: rows.length,
      inserted: 0,
      updated: 0,
      skipped: preflightErrors.length ? rows.length : 0,
      errors: preflightErrors,
      uploadBatchId: 'dry-run',
      dryRun: true,
    };
  }
  const upload = await prisma.uploadBatch.create({
    data: {
      dataset: DATASET_TYPE[dataset],
      fileName: opts.fileName,
      uploadedById: opts.userId,
      status: preflightErrors.length ? 'FAILED' : 'PROCESSING',
      rowsTotal: rows.length,
      rowsSkipped: preflightErrors.length ? rows.length : 0,
      errorReport: preflightErrors.slice(0, 50) as unknown as Prisma.InputJsonValue,
    },
  });

  if (preflightErrors.length) {
    return {
      dataset,
      rowsTotal: rows.length,
      inserted: 0,
      updated: 0,
      skipped: rows.length,
      errors: preflightErrors,
      uploadBatchId: upload.id,
    };
  }

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
          await prisma.$transaction(async (tx) => {
            const barcodeValue = await generateProductBarcode(tx);
            await tx.product.create({ data: { sku, ...data, barcodeValue } });
          });
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
        try {
          const result = await prisma.$transaction(
            (tx) => upsertImportedRoastBatch(tx, b, {
              branchId,
              uploadBatchId: upload.id,
              userId: opts.userId,
            }),
            { timeout: 60_000 },
          );
          if (result.inserted) inserted += 1;
          else updated += 1;
          for (const itemId of result.touchedItemIds) await syncActiveCost(itemId);
        } catch (error) {
          skipped += 1;
          errors.push({
            row: 0,
            message: `${b.batchNumber}: ${error instanceof Error ? error.message : 'import failed'}`,
          });
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
    } else if (dataset === 'purchases') {
      const parsed = parsePurchases(rows);
      errors.push(...parsed.errors);
      if (errors.length) {
        skipped = rows.length;
      } else {
        const successful: PurchaseInput[] = [];
        for (const purchase of parsed.valid) {
          let result: Awaited<ReturnType<typeof ingestPurchaseRecord>>;
          try {
            result = await prisma.$transaction(
              (tx) => ingestPurchaseRecord(tx, purchase, upload.id, opts.userId),
              { timeout: 60_000 },
            );
          } catch (error) {
            skipped += purchase.lines.length;
            errors.push({
              row: 0,
              message: `${purchase.recordKey}: ${error instanceof Error ? error.message : 'import failed'}`,
            });
            continue;
          }
          if (result.inserted) inserted += 1;
          else updated += 1;
          successful.push(purchase);
          try {
            for (const itemId of result.touchedItems) await syncActiveCost(itemId);
          } catch (error) {
            errors.push({
              row: 0,
              message: `${purchase.recordKey} inventory cost refresh: ${error instanceof Error ? error.message : 'failed'}`,
            });
          }
        }
        if (successful.length) {
          try {
            await syncImportedAssets(successful, opts.userId);
          } catch (error) {
            errors.push({
              row: 0,
              message: `asset sync: ${error instanceof Error ? error.message : 'import failed'}`,
            });
          }
        }
      }
    } else if (dataset === 'capital') {
      const parsed = parseCapital(rows);
      errors.push(...parsed.errors);
      if (errors.length) {
        skipped = rows.length;
      } else {
        const fallbackRate = await getUsdToIqd();
        for (const contribution of parsed.valid) {
          try {
            const wasInserted = await prisma.$transaction(async (tx) => {
              const branchId = await resolveImportBranch(tx, contribution.branchCode);
              const account = await resolveImportAccount(tx, contribution.account, branchId);
              const shareholderId = await resolveImportParty(tx, contribution.shareholder, 'SHAREHOLDER');
              const existing = await tx.financeEntry.findUnique({
                where: { importKey: contribution.importKey },
                select: { id: true },
              });
              if (existing) await tx.financeEntry.delete({ where: { id: existing.id } });
              const payMinor = toMinor(contribution.amount, contribution.currency);
              const usd = contribution.currency === 'USD';
              const rate = usd ? Math.round(fallbackRate) : null;
              await tx.financeEntry.create({
                data: {
                  date: contribution.date,
                  type: 'CAPITAL_IN',
                  amount: usd ? convertToIqd(payMinor, 'USD', rate as number) : payMinor,
                  currency: 'IQD',
                  origCurrency: usd ? 'USD' : null,
                  origAmount: usd ? payMinor : null,
                  fxRate: rate,
                  obligation: false,
                  accountId: account.id,
                  partyId: shareholderId,
                  paymentMethod: account.type === 'CASH' ? 'CASH' : 'OTHER',
                  branchId,
                  reference: contribution.reference ?? null,
                  description: contribution.shareholder,
                  importKey: contribution.importKey,
                  createdById: opts.userId,
                },
              });
              return !existing;
            }, { timeout: 60_000 });
            if (wasInserted) inserted += 1;
            else updated += 1;
          } catch (error) {
            skipped += 1;
            errors.push({
              row: 0,
              message: `${contribution.importKey}: ${error instanceof Error ? error.message : 'import failed'}`,
            });
          }
        }
      }
    } else if (dataset === 'shipments') {
      const { valid, errors: e } = parseShipments(rows);
      errors.push(...e);
      for (const s of valid) {
        try {
          const wasInserted = await prisma.$transaction(
            (tx) => upsertImportedShipment(tx, s, { userId: opts.userId }),
            { timeout: 60_000 },
          );
          if (wasInserted) inserted += 1;
          else updated += 1;
        } catch (error) {
          skipped += 1;
          errors.push({
            row: 0,
            message: `${s.orderNumber}: ${error instanceof Error ? error.message : 'import failed'}`,
          });
        }
      }
    } else {
      // orders
      const branchId = await defaultBranchId(opts.branchId);
      const { valid, errors: e } = parseOrders(rows);
      errors.push(...e);
      const roles = await getOrderStatusRoleMap();
      const saleStatuses = [...roles].filter(([, role]) => role === 'SALE').map(([code]) => code);
      for (const order of valid) {
        try {
          const result = await prisma.$transaction(
            (tx) => upsertImportedOrder(tx, order, {
              branchId,
              uploadBatchId: upload.id,
              userId: opts.userId,
              statusRole: roles.get(order.status) ?? 'UNKNOWN',
              saleStatuses,
            }),
            { timeout: 60_000 },
          );
          if (result.inserted) inserted += 1;
          else updated += 1;
          const touchedItems = await prisma.inventoryItem.findMany({
            where: { productId: { in: result.productIds } },
            select: { id: true },
          });
          for (const item of touchedItems) await syncActiveCost(item.id);
        } catch (error) {
          skipped += order.lines.length;
          errors.push({
            row: 0,
            message: `${order.orderNumber}: ${error instanceof Error ? error.message : 'import failed'}`,
          });
        }
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
