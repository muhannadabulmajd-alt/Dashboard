import 'server-only';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Apply finished-goods deductions for products that have an active stock item. */
export async function applySoldMovements(
  tx: Tx,
  orderId: string,
  occurredAt: Date,
  lines: { productId: string; quantity: number }[],
): Promise<void> {
  const ids = lines.map((line) => line.productId);
  const items = await tx.inventoryItem.findMany({
    where: { productId: { in: ids }, isActive: true },
    select: { id: true, productId: true },
  });
  const products = await tx.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, trackInventory: true },
  });
  const byProduct = new Map(items.flatMap((item) => item.productId ? [[item.productId, item.id]] : []));
  const untracked = new Set(products.filter((product) => !product.trackInventory).map((product) => product.id));
  const data = lines.flatMap((line) => {
    const inventoryItemId = byProduct.get(line.productId);
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
