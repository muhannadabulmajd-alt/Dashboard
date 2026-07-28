import 'server-only';
import type { Prisma } from '@prisma/client';

const activeAllocationWhere = {
  financeEntry: {
    archivedAt: null,
    reversedAt: null,
    reversalOfId: null,
  },
} as const;

export async function captureLayerBaseCosts(
  tx: Prisma.TransactionClient,
  layerIds: Iterable<string>,
): Promise<Map<string, number>> {
  const ids = [...new Set(layerIds)];
  if (!ids.length) return new Map();
  const layers = await tx.inventoryCostLayer.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      qtyReceived: true,
      unitCost: true,
      landedCostAllocations: {
        where: activeAllocationWhere,
        select: { amount: true },
      },
    },
  });
  return new Map(
    layers.map((layer) => {
      const quantity = Number(layer.qtyReceived);
      if (quantity <= 0) throw new Error('invalid_cost_layer');
      const allocated = layer.landedCostAllocations.reduce(
        (sum, allocation) => sum + allocation.amount,
        0,
      );
      return [layer.id, Number(layer.unitCost) - allocated / quantity];
    }),
  );
}

export async function syncLayerLandedCosts(
  tx: Prisma.TransactionClient,
  baseCosts: Map<string, number>,
): Promise<string[]> {
  const touchedItemIds: string[] = [];
  for (const [layerId, baseCost] of baseCosts) {
    const layer = await tx.inventoryCostLayer.findUnique({
      where: { id: layerId },
      select: {
        inventoryItemId: true,
        qtyReceived: true,
        landedCostAllocations: {
          where: activeAllocationWhere,
          select: { amount: true },
        },
      },
    });
    if (!layer) continue;
    const quantity = Number(layer.qtyReceived);
    if (quantity <= 0) throw new Error('invalid_cost_layer');
    const allocated = layer.landedCostAllocations.reduce(
      (sum, allocation) => sum + allocation.amount,
      0,
    );
    await tx.inventoryCostLayer.update({
      where: { id: layerId },
      data: { unitCost: (baseCost + allocated / quantity).toFixed(3) },
    });
    touchedItemIds.push(layer.inventoryItemId);
  }
  return touchedItemIds;
}
