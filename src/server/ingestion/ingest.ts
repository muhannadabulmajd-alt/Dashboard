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
import { syncActiveCost } from '@/server/inventory/fifo';

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
      const parsed = dataset === 'purchases' ? parsePurchases(rows) : parseCapital(rows);
      errors.push(...parsed.errors);
      if (parsed.errors.length) {
        skipped = rows.length;
      } else {
        const fallbackRate = dataset === 'capital' ? await getUsdToIqd() : null;
        const touchedItems = new Set<string>();
        let txInserted = 0;
        let txUpdated = 0;
        await prisma.$transaction(async (tx) => {
          const partyCache = new Map<string, string>();
          const branchCache = new Map<string, string>();
          const accountCache = new Map<string, { id: string; type: string }>();

          const resolveParty = async (name: string, type: 'SUPPLIER' | 'SHAREHOLDER') => {
            const key = name.trim();
            const cached = partyCache.get(key);
            if (cached) return cached;
            const found = await tx.party.findFirst({ where: { name: key }, select: { id: true } });
            const party = found ?? (await tx.party.create({ data: { name: key, type }, select: { id: true } }));
            partyCache.set(key, party.id);
            return party.id;
          };
          const resolveBranch = async (code: string) => {
            const key = code.trim().toUpperCase();
            const cached = branchCache.get(key);
            if (cached) return cached;
            const branch = await tx.branch.findUnique({ where: { code: key }, select: { id: true } });
            if (!branch) throw new Error(`unknown branch ${code}`);
            branchCache.set(key, branch.id);
            return branch.id;
          };
          const resolveAccount = async (name: string, branchId: string) => {
            const key = `${branchId}:${name.trim().toLowerCase()}`;
            const cached = accountCache.get(key);
            if (cached) return cached;
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
            accountCache.set(key, account);
            return account;
          };

          if (dataset === 'purchases') {
            const purchases = parsed.valid as ReturnType<typeof parsePurchases>['valid'];
            const assetGroups = new Map<string, {
              name: string;
              category: string;
              totalCost: number;
              quantity: number;
              unit: string;
              purchaseDate: Date;
              partyId: string;
              branchId: string;
              financeEntryId: string;
              references: string[];
            }>();

            for (const purchase of purchases) {
              const branchId = await resolveBranch(purchase.branchCode);
              const account = purchase.paymentMode === 'PAID'
                ? await resolveAccount(purchase.paymentAccount, branchId)
                : null;
              const supplierId = await resolveParty(purchase.supplier, 'SUPPLIER');
              const existing = await tx.financeEntry.findUnique({
                where: { importKey: purchase.importKey },
                select: { id: true, costLayers: { select: { inventoryItemId: true } } },
              });
              if (existing) {
                existing.costLayers.forEach((layer) => touchedItems.add(layer.inventoryItemId));
                await tx.fixedAsset.deleteMany({ where: { financeEntryId: existing.id } });
                await tx.inventoryCostLayer.deleteMany({ where: { financeEntryId: existing.id } });
                await tx.stockMovement.deleteMany({ where: { financeEntryId: existing.id } });
                await tx.financeEntry.deleteMany({ where: { settlesId: existing.id } });
                await tx.financeEntry.delete({ where: { id: existing.id } });
                txUpdated += 1;
              } else {
                txInserted += 1;
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
                  createdById: opts.userId,
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
                      uploadBatchId: upload.id,
                    },
                  });
                }

                await tx.ledgerEntryLine.create({
                  data: {
                    financeEntryId: entry.id,
                    lineNo: line.lineNo,
                    itemType: line.itemType,
                    itemName: line.itemName,
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

                if (line.itemType === 'ASSET' && line.assetKey && line.assetCategory) {
                  const current = assetGroups.get(line.assetKey);
                  if (current) {
                    current.totalCost += line.lineAmountIqd;
                    current.quantity = Math.max(current.quantity, line.quantity);
                    current.purchaseDate = current.purchaseDate < purchase.date ? current.purchaseDate : purchase.date;
                    current.financeEntryId = entry.id;
                    current.references.push(purchase.reference);
                  } else {
                    assetGroups.set(line.assetKey, {
                      name: line.itemName,
                      category: line.assetCategory,
                      totalCost: line.lineAmountIqd,
                      quantity: line.quantity,
                      unit: line.unit,
                      purchaseDate: purchase.date,
                      partyId: supplierId,
                      branchId,
                      financeEntryId: entry.id,
                      references: [purchase.reference],
                    });
                  }
                }
              }
            }

            for (const [assetKey, asset] of assetGroups) {
              await tx.fixedAsset.upsert({
                where: { importKey: `ASSET:HISTORICAL_SPEND:${assetKey}` },
                create: {
                  importKey: `ASSET:HISTORICAL_SPEND:${assetKey}`,
                  name: asset.name,
                  category: asset.category,
                  quantity: asset.quantity.toFixed(3),
                  unit: asset.unit,
                  totalCost: asset.totalCost,
                  unitCost: (asset.totalCost / asset.quantity).toFixed(3),
                  purchaseDate: asset.purchaseDate,
                  partyId: asset.partyId,
                  branchId: asset.branchId,
                  financeEntryId: asset.financeEntryId,
                  notes: `Historical purchase references: ${[...new Set(asset.references)].join(', ')}`,
                  createdById: opts.userId,
                },
                update: {
                  name: asset.name,
                  category: asset.category,
                  quantity: asset.quantity.toFixed(3),
                  unit: asset.unit,
                  totalCost: asset.totalCost,
                  unitCost: (asset.totalCost / asset.quantity).toFixed(3),
                  purchaseDate: asset.purchaseDate,
                  partyId: asset.partyId,
                  branchId: asset.branchId,
                  financeEntryId: asset.financeEntryId,
                  notes: `Historical purchase references: ${[...new Set(asset.references)].join(', ')}`,
                  isActive: true,
                  archivedAt: null,
                  archivedById: null,
                  archiveReason: null,
                },
              });
            }
          } else {
            const capital = parsed.valid as ReturnType<typeof parseCapital>['valid'];
            for (const contribution of capital) {
              const branchId = await resolveBranch(contribution.branchCode);
              const account = await resolveAccount(contribution.account, branchId);
              const shareholderId = await resolveParty(contribution.shareholder, 'SHAREHOLDER');
              const existing = await tx.financeEntry.findUnique({ where: { importKey: contribution.importKey }, select: { id: true } });
              if (existing) {
                await tx.financeEntry.delete({ where: { id: existing.id } });
                txUpdated += 1;
              } else {
                txInserted += 1;
              }
              const payMinor = toMinor(contribution.amount, contribution.currency);
              const usd = contribution.currency === 'USD';
              const rate = usd ? Math.round(fallbackRate as number) : null;
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
            }
          }
        }, { timeout: 30_000 });
        inserted += txInserted;
        updated += txUpdated;
        for (const itemId of touchedItems) await syncActiveCost(itemId);
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
