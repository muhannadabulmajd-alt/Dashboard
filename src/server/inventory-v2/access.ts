import 'server-only';
import type { Prisma, Role } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/session';

type Tx = Prisma.TransactionClient;

export type LocationPermission =
  | 'view'
  | 'sell'
  | 'receive'
  | 'count'
  | 'recordExpense'
  | 'produce'
  | 'dispatch'
  | 'approve';

const GLOBAL_LOCATION_ROLES: Role[] = ['OWNER', 'ADMIN'];

const permissionField: Record<Exclude<LocationPermission, 'view'>, keyof {
  canSell: boolean;
  canReceive: boolean;
  canCount: boolean;
  canRecordExpense: boolean;
  canProduce: boolean;
  canDispatch: boolean;
  canApprove: boolean;
}> = {
  sell: 'canSell',
  receive: 'canReceive',
  count: 'canCount',
  recordExpense: 'canRecordExpense',
  produce: 'canProduce',
  dispatch: 'canDispatch',
  approve: 'canApprove',
};

export function hasGlobalLocationAccess(role: Role): boolean {
  return GLOBAL_LOCATION_ROLES.includes(role);
}

export function stockLocationWhereForPermission(
  actor: CurrentUser,
  permission: LocationPermission,
): Prisma.StockLocationWhereInput {
  if (hasGlobalLocationAccess(actor.role)) return {};
  const access: Prisma.UserLocationAccessWhereInput = {
    userId: actor.id,
    canView: true,
  };
  if (permission !== 'view') access[permissionField[permission]] = true;
  return { userAccesses: { some: access } };
}

export async function assertLocationPermission(
  tx: Tx,
  actor: CurrentUser,
  locationId: string,
  permission: LocationPermission,
) {
  const location = await tx.stockLocation.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      branchId: true,
      type: true,
      isActive: true,
      isSystem: true,
      stockVersion: true,
    },
  });
  if (!location?.isActive) throw new Error('location_not_found');
  if (hasGlobalLocationAccess(actor.role)) return location;

  const access = await tx.userLocationAccess.findUnique({
    where: { userId_locationId: { userId: actor.id, locationId } },
  });
  if (!access?.canView) throw new Error('location_forbidden');
  if (permission !== 'view' && !access[permissionField[permission]]) {
    throw new Error(`location_${permission}_forbidden`);
  }
  return location;
}

export async function getLocationScope(
  tx: Tx,
  actor: CurrentUser,
): Promise<{ unrestricted: boolean; locationIds: string[]; branchIds: string[] }> {
  if (hasGlobalLocationAccess(actor.role)) {
    return { unrestricted: true, locationIds: [], branchIds: [] };
  }
  const rows = await tx.userLocationAccess.findMany({
    where: { userId: actor.id, canView: true, location: { isActive: true } },
    select: { locationId: true, location: { select: { branchId: true } } },
  });
  return {
    unrestricted: false,
    locationIds: rows.map((row) => row.locationId),
    branchIds: [...new Set(rows.map((row) => row.location.branchId))],
  };
}
