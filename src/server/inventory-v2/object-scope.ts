import 'server-only';
import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';
import { buildBranchScope } from '@/server/filters/where-builder';
import { getInventoryV2Config } from './config';
import { hasGlobalLocationAccess } from './access';

export type LocationObjectScope = {
  unrestricted: boolean;
  locationIds: string[];
  branchIds: string[];
};

type ScopeClient = typeof prisma | Prisma.TransactionClient;

export async function resolveLocationObjectScope(
  actor: CurrentUser,
  client: ScopeClient = prisma,
): Promise<LocationObjectScope> {
  if (!getInventoryV2Config().enabled) {
    const legacy = buildBranchScope(actor);
    return {
      unrestricted: !legacy.branchId,
      locationIds: [],
      branchIds: legacy.branchId ? [legacy.branchId] : [],
    };
  }
  if (hasGlobalLocationAccess(actor.role)) {
    return { unrestricted: true, locationIds: [], branchIds: [] };
  }
  const rows = await client.userLocationAccess.findMany({
    where: { userId: actor.id, canView: true, location: { isActive: true } },
    select: { locationId: true, location: { select: { branchId: true } } },
  });
  return {
    unrestricted: false,
    locationIds: rows.map((row) => row.locationId),
    branchIds: [...new Set(rows.map((row) => row.location.branchId))],
  };
}

export function financeAccountWhereForScope(
  scope: LocationObjectScope,
): Prisma.FinanceAccountWhereInput {
  if (scope.unrestricted) return {};
  if (!getInventoryV2Config().enabled) return { branchId: { in: scope.branchIds } };
  return { stockLocationId: { in: scope.locationIds } };
}

export function orderWhereForScope(scope: LocationObjectScope): Prisma.OrderWhereInput {
  if (scope.unrestricted) return {};
  if (!getInventoryV2Config().enabled) return { branchId: { in: scope.branchIds } };
  return { fulfillmentLocationId: { in: scope.locationIds } };
}

export function roastBatchWhereForScope(
  scope: LocationObjectScope,
): Prisma.RoastBatchWhereInput {
  if (scope.unrestricted) return {};
  if (!getInventoryV2Config().enabled) return { branchId: { in: scope.branchIds } };
  return { locationId: { in: scope.locationIds } };
}

export function inventoryItemWhereForScope(
  scope: LocationObjectScope,
): Prisma.InventoryItemWhereInput {
  if (scope.unrestricted) return {};
  if (!getInventoryV2Config().enabled) return { branchId: { in: scope.branchIds } };
  return {
    locationPolicies: { some: { locationId: { in: scope.locationIds }, isActive: true } },
  };
}

export function stockDocumentWhereForScope(
  scope: LocationObjectScope,
): Prisma.StockDocumentWhereInput {
  if (scope.unrestricted) return {};
  if (!getInventoryV2Config().enabled) {
    return { movements: { some: { branchId: { in: scope.branchIds } } } };
  }
  return {
    OR: [
      { sourceLocationId: { in: scope.locationIds } },
      { destinationLocationId: { in: scope.locationIds } },
      { movements: { some: { locationId: { in: scope.locationIds } } } },
    ],
  };
}

export async function assertOrderObjectAccess(
  actor: CurrentUser,
  orderId: string,
  client: ScopeClient = prisma,
): Promise<void> {
  const scope = await resolveLocationObjectScope(actor, client);
  const found = await client.order.findFirst({
    where: { id: orderId, ...orderWhereForScope(scope) },
    select: { id: true },
  });
  if (!found) throw new Error('forbidden');
}

export async function assertOrdersObjectAccess(
  actor: CurrentUser,
  orderIds: string[],
  client: ScopeClient = prisma,
): Promise<void> {
  const uniqueIds = [...new Set(orderIds)];
  const scope = await resolveLocationObjectScope(actor, client);
  const count = await client.order.count({
    where: { id: { in: uniqueIds }, ...orderWhereForScope(scope) },
  });
  if (count !== uniqueIds.length) throw new Error('forbidden');
}

export async function assertInventoryItemObjectAccess(
  actor: CurrentUser,
  inventoryItemId: string,
  client: ScopeClient = prisma,
): Promise<void> {
  const scope = await resolveLocationObjectScope(actor, client);
  const found = await client.inventoryItem.findFirst({
    where: { id: inventoryItemId, ...inventoryItemWhereForScope(scope) },
    select: { id: true },
  });
  if (!found) throw new Error('forbidden');
}

export async function assertRoastBatchObjectAccess(
  actor: CurrentUser,
  roastBatchId: string,
  client: ScopeClient = prisma,
): Promise<void> {
  const scope = await resolveLocationObjectScope(actor, client);
  const found = await client.roastBatch.findFirst({
    where: { id: roastBatchId, ...roastBatchWhereForScope(scope) },
    select: { id: true },
  });
  if (!found) throw new Error('forbidden');
}

export async function assertFinanceAccountObjectAccess(
  actor: CurrentUser,
  financeAccountId: string,
  client: ScopeClient = prisma,
): Promise<void> {
  const scope = await resolveLocationObjectScope(actor, client);
  const found = await client.financeAccount.findFirst({
    where: { id: financeAccountId, ...financeAccountWhereForScope(scope) },
    select: { id: true },
  });
  if (!found) throw new Error('forbidden');
}
