import 'server-only';
import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/session';
import { decimalNumber } from '@/lib/decimal';
import { assertLocationPermission, type LocationPermission } from './access';
import { getLotBalances } from './availability';
import { selectLotAllocations } from './lot-allocation';

export type Tx = Prisma.TransactionClient;

export async function lockLocation(
  tx: Tx,
  actor: CurrentUser,
  locationId: string,
  permission: LocationPermission,
  expectedVersion: number,
) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "StockLocation" WHERE "id" = ${locationId} FOR UPDATE
  `;
  const location = await assertLocationPermission(tx, actor, locationId, permission);
  if (location.stockVersion !== expectedVersion) throw new Error('location_stale');
  return location;
}

export async function bumpLocationVersion(tx: Tx, locationId: string): Promise<number> {
  const location = await tx.stockLocation.update({
    where: { id: locationId },
    data: { stockVersion: { increment: 1 } },
    select: { stockVersion: true },
  });
  return location.stockVersion;
}

export async function assertLocationItemPolicy(
  tx: Tx,
  inventoryItemId: string,
  locationId: string,
  permission?: 'sell' | 'produce',
) {
  const [item, policy] = await Promise.all([
    tx.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      select: {
        id: true,
        nameEn: true,
        nameAr: true,
        unit: true,
        unitCost: true,
        productId: true,
        category: true,
        isActive: true,
      },
    }),
    tx.inventoryLocationPolicy.findUnique({
      where: { inventoryItemId_locationId: { inventoryItemId, locationId } },
    }),
  ]);
  if (!item?.isActive) throw new Error('inventory_item_not_found');
  if (!policy?.isActive) throw new Error('inventory_location_not_configured');
  if (permission === 'sell' && !policy.canSell) throw new Error('inventory_not_sellable_here');
  if (permission === 'produce' && !policy.canProduce) throw new Error('inventory_not_producible_here');
  return { item, policy };
}

export async function allocateLocationLots(
  tx: Tx,
  inventoryItemId: string,
  locationId: string,
  quantity: number,
) {
  const lots = await getLotBalances(tx, inventoryItemId, locationId);
  const selected = selectLotAllocations(lots, quantity);
  if (selected.shortage > 0) {
    const available = lots.reduce((sum, lot) => sum + Math.max(0, lot.quantity), 0);
    throw new Error(`stock_insufficient:${inventoryItemId}:${available}:${quantity}`);
  }
  return selected.allocations;
}

export async function activeReservationQuantity(
  tx: Tx,
  inventoryItemId: string,
  locationId: string,
  at = new Date(),
): Promise<number> {
  const result = await tx.stockReservation.aggregate({
    where: {
      inventoryItemId,
      locationId,
      status: 'ACTIVE',
      OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
    },
    _sum: { quantity: true },
  });
  return decimalNumber(result._sum.quantity);
}

export async function auditStockCommand(
  tx: Tx,
  actor: CurrentUser,
  action: string,
  entity: string,
  entityId: string,
  metadata: Prisma.InputJsonValue,
): Promise<string> {
  const row = await tx.auditLog.create({
    data: { userId: actor.id, action, entity, entityId, metadata },
    select: { id: true },
  });
  return row.id;
}
