import 'server-only';
import type { InventorySyncMode, Prisma } from '@prisma/client';
import { decimalNumber } from '@/lib/decimal';

type Tx = Prisma.TransactionClient;

export type OrderInventoryReadiness = {
  mode: InventorySyncMode;
  unconfiguredSkus: string[];
};

/** Decide whether an order can participate in live stock accounting. */
export async function resolveOrderInventoryReadiness(
  tx: Tx,
  productIds: string[],
): Promise<OrderInventoryReadiness> {
  const ids = [...new Set(productIds)].sort();
  const products = await tx.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, sku: true, trackInventory: true, isActive: true },
  });
  if (products.length !== ids.length || products.some((product) => !product.isActive)) {
    throw new Error('product_inactive');
  }

  const items = await tx.inventoryItem.findMany({
    where: { productId: { in: ids }, isActive: true },
    select: { id: true, productId: true },
    orderBy: { id: 'asc' },
  });
  const itemsByProduct = new Map<string, string[]>();
  for (const item of items) {
    if (!item.productId) continue;
    itemsByProduct.set(item.productId, [...(itemsByProduct.get(item.productId) ?? []), item.id]);
  }

  const unconfiguredSkus: string[] = [];
  for (const product of products) {
    if (!product.trackInventory) continue;
    const linked = itemsByProduct.get(product.id) ?? [];
    if (linked.length > 1) throw new Error(`stock_configuration_ambiguous:${product.sku}`);
    if (linked.length === 0) unconfiguredSkus.push(product.sku);
  }

  return {
    mode: unconfiguredSkus.length ? 'SKIP_HISTORICAL' : 'NORMAL',
    unconfiguredSkus,
  };
}

/** Lock, validate, and apply finished-goods deductions atomically. */
export async function applySoldMovements(
  tx: Tx,
  orderId: string,
  occurredAt: Date,
  lines: { productId: string; quantity: number }[],
): Promise<void> {
  const ids = [...new Set(lines.map((line) => line.productId))].sort();
  const products = await tx.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, sku: true, trackInventory: true, isActive: true },
  });
  if (products.length !== ids.length || products.some((product) => !product.isActive)) throw new Error('product_inactive');
  for (const id of ids) {
    await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id} FOR UPDATE`;
  }
  const items = await tx.inventoryItem.findMany({
    where: { productId: { in: ids }, isActive: true },
    select: { id: true, productId: true },
    orderBy: { id: 'asc' },
  });
  for (const item of items) {
    await tx.$queryRaw`SELECT "id" FROM "InventoryItem" WHERE "id" = ${item.id} FOR UPDATE`;
  }
  const currentItems = await tx.inventoryItem.findMany({
    where: { productId: { in: ids }, isActive: true },
    select: { id: true, productId: true },
    orderBy: { id: 'asc' },
  });
  const itemsByProduct = new Map<string, string[]>();
  for (const item of currentItems) {
    if (!item.productId) continue;
    itemsByProduct.set(item.productId, [...(itemsByProduct.get(item.productId) ?? []), item.id]);
  }
  for (const product of products) {
    if (!product.trackInventory) continue;
    const linked = itemsByProduct.get(product.id) ?? [];
    if (linked.length === 0) throw new Error(`stock_not_configured:${product.sku}`);
    if (linked.length > 1) throw new Error(`stock_configuration_ambiguous:${product.sku}`);
  }

  const requiredByItem = new Map<string, number>();
  for (const line of lines) {
    const product = products.find((row) => row.id === line.productId);
    if (!product?.trackInventory) continue;
    const inventoryItemId = itemsByProduct.get(line.productId)?.[0];
    if (!inventoryItemId) throw new Error('stock_not_configured');
    requiredByItem.set(inventoryItemId, (requiredByItem.get(inventoryItemId) ?? 0) + line.quantity);
  }
  for (const [inventoryItemId, required] of requiredByItem) {
    const available = await tx.stockMovement.aggregate({
      where: {
        inventoryItemId,
        OR: [
          { financeEntryId: null },
          { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } },
        ],
      },
      _sum: { quantity: true },
    });
    const quantity = decimalNumber(available._sum.quantity);
    if (quantity < required) throw new Error(`stock_insufficient:${inventoryItemId}:${quantity}:${required}`);
  }

  const untracked = new Set(products.filter((product) => !product.trackInventory).map((product) => product.id));
  const data = lines.flatMap((line) => {
    const inventoryItemId = itemsByProduct.get(line.productId)?.[0];
    return inventoryItemId && !untracked.has(line.productId)
      ? [{ inventoryItemId, orderId, occurredAt, reason: 'SOLD' as const, quantity: -line.quantity }]
      : [];
  });
  if (data.length) await tx.stockMovement.createMany({ data });
}

/** Rebuild cached customer sales dates/counts using completed-sale statuses only. */
export async function syncCustomerStats(
  tx: Tx,
  customerId: string | null | undefined,
  saleStatuses: string[],
): Promise<void> {
  if (!customerId) return;
  const stats = await tx.order.aggregate({
    where: { customerId, status: { in: saleStatuses }, purpose: 'SALE' },
    _count: { _all: true },
    _min: { placedAt: true },
    _max: { placedAt: true },
  });
  await tx.customer.update({
    where: { id: customerId },
    data: {
      ordersCount: stats._count._all,
      firstOrderAt: stats._min.placedAt,
      lastOrderAt: stats._max.placedAt,
    },
  });
}
