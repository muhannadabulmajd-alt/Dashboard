import 'server-only';
import type { Prisma } from '@prisma/client';
import { decimalNumber } from '@/lib/decimal';

type Tx = Prisma.TransactionClient;

export type LocationAvailability = {
  inventoryItemId: string;
  locationId: string;
  stockVersion: number;
  onHand: number;
  reserved: number;
  available: number;
  inTransit: number;
  quarantine: number;
  producible: number;
  nextExpiry: Date | null;
};

async function movementBalance(
  tx: Tx,
  inventoryItemId: string,
  locationIds: string[],
): Promise<number> {
  if (!locationIds.length) return 0;
  const result = await tx.stockMovement.aggregate({
    where: {
      inventoryItemId,
      locationId: { in: locationIds },
      OR: [
        { financeEntryId: null },
        { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } },
      ],
    },
    _sum: { quantity: true },
  });
  return decimalNumber(result._sum.quantity);
}

export async function getLotBalances(
  tx: Tx,
  inventoryItemId: string,
  locationId: string,
) {
  const layers = await tx.inventoryCostLayer.findMany({
    where: {
      inventoryItemId,
      OR: [
        { financeEntryId: null },
        { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } },
      ],
    },
    select: {
      id: true,
      lotNumber: true,
      supplierLot: true,
      qtyReceived: true,
      unitCost: true,
      receivedAt: true,
      roastDate: true,
      packedAt: true,
      bestBefore: true,
    },
  });
  if (!layers.length) return [];
  const sums = await tx.stockMovement.groupBy({
    by: ['costLayerId'],
    where: {
      inventoryItemId,
      locationId,
      costLayerId: { in: layers.map((layer) => layer.id) },
      OR: [
        { financeEntryId: null },
        { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } },
      ],
    },
    _sum: { quantity: true },
  });
  const byLayer = new Map(sums.map((row) => [row.costLayerId, decimalNumber(row._sum.quantity)]));
  return layers.map((layer) => ({
      id: layer.id,
      lotNumber: layer.lotNumber,
      supplierLot: layer.supplierLot,
      quantity: byLayer.get(layer.id) ?? 0,
      unitCost: decimalNumber(layer.unitCost),
      receivedAt: layer.receivedAt,
      roastDate: layer.roastDate,
      packedAt: layer.packedAt,
      bestBefore: layer.bestBefore,
  }));
}

async function producibleQuantity(
  tx: Tx,
  productId: string | null,
  locationId: string,
  at: Date,
): Promise<number> {
  if (!productId) return 0;
  const recipe = await tx.productRecipeVersion.findFirst({
    where: { productId, isActive: true },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    include: { components: true },
  });
  if (!recipe?.components.length) return 0;
  let capacity = Number.POSITIVE_INFINITY;
  for (const component of recipe.components) {
    if (!component.inventoryItemId || decimalNumber(component.quantity) <= 0) continue;
    const [onHand, reservation] = await Promise.all([
      movementBalance(tx, component.inventoryItemId, [locationId]),
      tx.stockReservation.aggregate({
        where: {
          inventoryItemId: component.inventoryItemId,
          locationId,
          status: 'ACTIVE',
          OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
        },
        _sum: { quantity: true },
      }),
    ]);
    const available = Math.max(0, onHand - decimalNumber(reservation._sum.quantity));
    capacity = Math.min(capacity, Math.floor(available / decimalNumber(component.quantity)));
  }
  return Number.isFinite(capacity) ? Math.max(0, capacity) : 0;
}

export async function getLocationAvailability(
  tx: Tx,
  inventoryItemId: string,
  locationId: string,
  at = new Date(),
): Promise<LocationAvailability> {
  const [location, item] = await Promise.all([
    tx.stockLocation.findUnique({
      where: { id: locationId },
      select: { branchId: true, stockVersion: true, isActive: true },
    }),
    tx.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      select: { productId: true, isActive: true },
    }),
  ]);
  if (!location?.isActive) throw new Error('location_not_found');
  if (!item?.isActive) throw new Error('inventory_item_not_found');

  const siblingLocations = await tx.stockLocation.findMany({
    where: { branchId: location.branchId, type: { in: ['IN_TRANSIT', 'QUARANTINE'] }, isActive: true },
    select: { id: true, type: true },
  });
  const transitIds = siblingLocations.filter((row) => row.type === 'IN_TRANSIT').map((row) => row.id);
  const quarantineIds = siblingLocations.filter((row) => row.type === 'QUARANTINE').map((row) => row.id);
  const [onHand, reservation, inTransit, quarantine, lots, producible] = await Promise.all([
    movementBalance(tx, inventoryItemId, [locationId]),
    tx.stockReservation.aggregate({
      where: {
        inventoryItemId,
        locationId,
        status: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
      },
      _sum: { quantity: true },
    }),
    movementBalance(tx, inventoryItemId, transitIds),
    movementBalance(tx, inventoryItemId, quarantineIds),
    getLotBalances(tx, inventoryItemId, locationId),
    producibleQuantity(tx, item.productId, locationId, at),
  ]);
  const reserved = decimalNumber(reservation._sum.quantity);
  const nextExpiry = lots
    .filter((lot) => lot.quantity > 0 && lot.bestBefore)
    .sort((left, right) => left.bestBefore!.getTime() - right.bestBefore!.getTime())[0]?.bestBefore ?? null;

  return {
    inventoryItemId,
    locationId,
    stockVersion: location.stockVersion,
    onHand,
    reserved,
    available: Math.max(0, onHand - reserved),
    inTransit,
    quarantine,
    producible,
    nextExpiry,
  };
}
