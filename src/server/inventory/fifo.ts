import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { decimalNumber, roundMoney } from '@/lib/decimal';
import { fifoStatus } from '@/lib/metrics/inventory';

/**
 * Recompute cogsPerUnit for every product whose recipe links this inventory
 * item after the item's unit cost changes. Linked component rows take the live
 * item cost; product COGS = Σ(quantity × unitCost). Past order lines keep their
 * snapshot, so only future orders are affected. Shared by the manual cost edit
 * (inventory.ts) and the FIFO sync below.
 */
export async function recomputeProductsForItem(
  itemId: string,
  newCost: number,
  db: Prisma.TransactionClient = prisma,
): Promise<void> {
  const affected = await db.productComponent.findMany({
    where: { inventoryItemId: itemId },
    select: { productId: true },
  });
  if (!affected.length) return;
  await db.productComponent.updateMany({
    where: { inventoryItemId: itemId },
    data: { unitCost: newCost },
  });
  for (const productId of [...new Set(affected.map((a) => a.productId))]) {
    const comps = await db.productComponent.findMany({
      where: { productId },
      select: { quantity: true, unitCost: true },
    });
    const cost = comps.reduce((s, c) => s + decimalNumber(c.quantity) * decimalNumber(c.unitCost), 0);
    await db.product.update({
      where: { id: productId },
      data: { cogsPerUnit: roundMoney(cost) },
    });
  }
}

/**
 * Recompute an item's active FIFO cost (§8) from its immutable cost layers and
 * the quantity consumed since FIFO tracking began (Σ stock-out at/after the
 * first layer), then sync item.unitCost and any linked product costs.
 *
 * Forward-only: consumption before the first layer drew on pre-FIFO stock and
 * doesn't deplete layers. No-op for items without layers (FIFO not in use) or
 * when layers are fully depleted (keeps the last known cost rather than zeroing
 * it). Idempotent — always re-derived from scratch, so it's safe to call after
 * every order create/edit/cancel. Returns the active cost, else null.
 */
export async function syncActiveCost(
  itemId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<number | null> {
  const layers = await db.inventoryCostLayer.findMany({
    where: {
      inventoryItemId: itemId,
      OR: [
        { financeEntryId: null },
        { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } },
      ],
    },
    orderBy: { receivedAt: 'asc' },
    select: { id: true, qtyReceived: true, unitCost: true, receivedAt: true },
  });
  if (!layers.length) return null;
  const out = await db.stockMovement.aggregate({
    where: {
      inventoryItemId: itemId,
      quantity: { lt: 0 },
      occurredAt: { gte: layers[0].receivedAt },
      OR: [
        { financeEntryId: null },
        { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } },
      ],
    },
    _sum: { quantity: true },
  });
  const consumed = -decimalNumber(out._sum.quantity);
  const status = fifoStatus(
    layers.map((layer) => ({
      ...layer,
      qtyReceived: decimalNumber(layer.qtyReceived),
      unitCost: decimalNumber(layer.unitCost),
    })),
    consumed,
  );
  if (status.activeCost == null) return null; // depleted — keep the last cost
  const item = await db.inventoryItem.findUnique({
    where: { id: itemId },
    select: { unitCost: true },
  });
  if (item && decimalNumber(item.unitCost) !== status.activeCost) {
    await db.inventoryItem.update({
      where: { id: itemId },
      data: { unitCost: status.activeCost },
    });
    await recomputeProductsForItem(itemId, status.activeCost, db);
  }
  return status.activeCost;
}

/**
 * Resolve the finished-goods inventory items linked to these product variations
 * and refresh each one's active FIFO cost. Called after an order create/edit so
 * stock consumption rolls the active cost forward (or back, on cancel/edit).
 */
export async function syncActiveCostForProducts(
  productIds: string[],
  db: Prisma.TransactionClient = prisma,
): Promise<void> {
  const ids = [...new Set(productIds)].filter(Boolean);
  if (!ids.length) return;
  const items = await db.inventoryItem.findMany({
    where: { productId: { in: ids } },
    select: { id: true },
  });
  for (const it of items) await syncActiveCost(it.id, db);
}
