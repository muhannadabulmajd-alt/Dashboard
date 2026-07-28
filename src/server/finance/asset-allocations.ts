import 'server-only';
import type { Prisma } from '@prisma/client';

export async function syncAllocatedAssetTotals(
  tx: Prisma.TransactionClient,
  assetIds: Iterable<string>,
  input: { userId: string; reason: string },
): Promise<void> {
  for (const assetId of new Set(assetIds)) {
    const asset = await tx.fixedAsset.findUnique({
      where: { id: assetId },
      select: {
        quantity: true,
        costAllocations: {
          select: {
            amount: true,
            financeEntry: {
              select: { archivedAt: true, reversedAt: true, reversalOfId: true },
            },
          },
        },
      },
    });
    if (!asset) continue;
    const totalCost = asset.costAllocations
      .filter((allocation) => (
        !allocation.financeEntry.archivedAt
        && !allocation.financeEntry.reversedAt
        && !allocation.financeEntry.reversalOfId
      ))
      .reduce((total, allocation) => total + allocation.amount, 0);
    const active = totalCost > 0;
    const quantity = Number(asset.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('invalid_asset_quantity');
    }
    await tx.fixedAsset.update({
      where: { id: assetId },
      data: {
        totalCost,
        unitCost: active ? (totalCost / quantity).toFixed(3) : 0,
        isActive: active,
        archivedAt: active ? null : new Date(),
        archivedById: active ? null : input.userId,
        archiveReason: active ? null : input.reason,
      },
    });
  }
}
