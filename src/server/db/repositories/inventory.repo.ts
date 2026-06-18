import 'server-only';
import { prisma } from '../client';
import { buildMovementWhere } from '@/server/filters/where-builder';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';
import type { InventoryItemLike } from '@/lib/metrics/types';
import { decimalNumber } from '@/lib/decimal';

type Scope = { branchId?: string };

export async function getInventoryItems(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<InventoryItemLike[]> {
  const rows = await prisma.inventoryItem.findMany({
    where: scope.branchId
      ? { branchId: scope.branchId }
      : filters.branchId?.length
        ? { branchId: { in: filters.branchId } }
        : {},
    select: {
      id: true,
      category: true,
      nameEn: true,
      nameAr: true,
      unit: true,
      reorderPoint: true,
      avgDailyUsage: true,
      unitCost: true,
      movements: {
        where: {
          AND: [
            buildMovementWhere(filters, scope, range),
            { OR: [
              { financeEntryId: null },
              { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } },
            ] },
          ],
        },
        select: { occurredAt: true, reason: true, quantity: true, expiryDate: true },
        orderBy: { occurredAt: 'asc' },
      },
      costLayers: {
        where: {
          receivedAt: { lte: range.end },
          OR: [
            { financeEntryId: null },
            { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } },
          ],
        },
        select: { id: true, qtyReceived: true, unitCost: true, receivedAt: true },
        orderBy: { receivedAt: 'asc' },
      },
    },
  });
  return rows.map((item) => ({
    ...item,
    reorderPoint: item.reorderPoint == null ? null : decimalNumber(item.reorderPoint),
    unitCost: item.unitCost == null ? null : decimalNumber(item.unitCost),
    movements: item.movements.map((movement) => ({
      ...movement,
      quantity: decimalNumber(movement.quantity),
    })),
    costLayers: item.costLayers.map((layer) => ({
      ...layer,
      qtyReceived: decimalNumber(layer.qtyReceived),
      unitCost: decimalNumber(layer.unitCost),
    })),
  }));
}
