import 'server-only';
import { prisma } from '../client';
import {
  buildInventoryItemScopeWhere,
  buildMovementWhere,
  type DataScope,
} from '@/server/filters/where-builder';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';
import type { InventoryItemLike } from '@/lib/metrics/types';
import { decimalNumber } from '@/lib/decimal';
import { deriveLocationUnitCost } from '@/server/inventory-v2/location-valuation';

type Scope = DataScope;

export async function getInventoryItems(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<InventoryItemLike[]> {
  const locationScoped = scope.locationIds !== undefined;
  const rows = await prisma.inventoryItem.findMany({
    where: locationScoped || scope.branchId
      ? buildInventoryItemScopeWhere(scope)
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
      locationPolicies: {
        where: locationScoped
          ? { locationId: { in: scope.locationIds }, isActive: true }
          : { id: { in: [] } },
        select: { reorderPoint: true },
      },
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
        select: {
          occurredAt: true,
          reason: true,
          quantity: true,
          expiryDate: true,
          costLayer: { select: { unitCost: true } },
        },
        orderBy: { occurredAt: 'asc' },
      },
      costLayers: {
        where: {
          ...(locationScoped ? { id: { in: [] } } : {}),
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
  return rows.map((item) => {
    const fallbackUnitCost = item.unitCost == null ? null : decimalNumber(item.unitCost);
    const valuedMovements = item.movements.map((movement) => ({
      quantity: decimalNumber(movement.quantity),
      unitCost: movement.costLayer ? decimalNumber(movement.costLayer.unitCost) : null,
    }));
    const locationReorderPoints = item.locationPolicies
      .map((policy) => policy.reorderPoint)
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .map(decimalNumber);
    return {
      id: item.id,
      category: item.category,
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      unit: item.unit,
      reorderPoint: locationScoped
        ? locationReorderPoints.reduce((sum, value) => sum + value, 0) || null
        : item.reorderPoint == null
          ? null
          : decimalNumber(item.reorderPoint),
      avgDailyUsage: item.avgDailyUsage,
      unitCost: locationScoped
        ? deriveLocationUnitCost(valuedMovements, fallbackUnitCost)
        : fallbackUnitCost,
      movements: item.movements.map((movement) => ({
        occurredAt: movement.occurredAt,
        reason: movement.reason,
        quantity: decimalNumber(movement.quantity),
        expiryDate: movement.expiryDate,
      })),
      costLayers: item.costLayers.map((layer) => ({
        ...layer,
        qtyReceived: decimalNumber(layer.qtyReceived),
        unitCost: decimalNumber(layer.unitCost),
      })),
    };
  });
}
