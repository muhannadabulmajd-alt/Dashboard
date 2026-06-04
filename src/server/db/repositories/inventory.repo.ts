import 'server-only';
import { prisma } from '../client';
import { buildMovementWhere } from '@/server/filters/where-builder';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';
import type { InventoryItemLike } from '@/lib/metrics/types';

type Scope = { branchId?: string };

export async function getInventoryItems(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<InventoryItemLike[]> {
  return prisma.inventoryItem.findMany({
    where: scope.branchId ? { branchId: scope.branchId } : {},
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
        where: buildMovementWhere(filters, scope, range),
        select: { occurredAt: true, reason: true, quantity: true, expiryDate: true },
        orderBy: { occurredAt: 'asc' },
      },
    },
  });
}
