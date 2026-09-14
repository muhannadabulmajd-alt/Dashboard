import 'server-only';
import type { InventoryCategory } from '@prisma/client';
import { resolveRange } from '@/lib/dates';
import { accountBalance, type FinanceEntryLike } from '@/lib/metrics/finance';
import { netSales, salesOrderCount } from '@/lib/metrics/sales';
import type { CurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';
import { getOrderStatusRoleMap } from '@/server/lists/resolver';
import { assertLocationPermission } from './access';
import { getLocationAvailability } from './availability';
import { outstandingTransferLots } from './transfers';

export type InventoryArea = 'overview' | 'green' | 'roasted' | 'packaging' | 'finished';

const CATEGORIES_BY_AREA = {
  overview: null,
  green: ['GREEN_COFFEE'],
  roasted: ['ROASTED'],
  packaging: ['PACKAGING', 'DRIP_BAGS', 'PRODUCTION_SUPPLY'],
  finished: ['FINISHED_GOOD', 'ACCESSORY'],
} as const;

export function categoriesForInventoryArea(area: InventoryArea): readonly InventoryCategory[] | null {
  return CATEGORIES_BY_AREA[area] as readonly InventoryCategory[] | null;
}

export function summarizeLocationCash(
  accounts: Array<{ id: string; openingBalance: number }>,
  entries: FinanceEntryLike[],
): number {
  return accounts.reduce((total, account) => total + accountBalance(account, entries), 0);
}

export function locationCashAccountWhere(locationId: string) {
  return {
    stockLocationId: locationId,
    isActive: true,
    currency: 'IQD' as const,
    type: 'CASH' as const,
  };
}

function emptyOperations() {
  return {
    todaySales: 0,
    todayOrders: 0,
    localCash: 0,
    localCashAccounts: [] as Array<{ id: string; name: string; balance: number }>,
    pendingCountTotal: 0,
    replenishmentTotal: 0,
    incomingTransferTotal: 0,
    lowStockTotal: 0,
    pendingCounts: [] as Array<never>,
    replenishmentRequests: [] as Array<never>,
    incomingTransfers: [] as Array<never>,
  };
}

export async function getInventoryLocationOverview(
  actor: CurrentUser,
  input: { locationId?: string; area?: InventoryArea },
) {
  const global = actor.role === 'OWNER' || actor.role === 'ADMIN';
  const locations = await prisma.stockLocation.findMany({
    where: {
      isActive: true,
      ...(global ? {} : { userAccesses: { some: { userId: actor.id, canView: true } } }),
    },
    include: { branch: { select: { nameEn: true, nameAr: true } } },
    orderBy: [
      { isCentralFulfillment: 'desc' },
      { branch: { nameEn: 'asc' } },
      { nameEn: 'asc' },
    ],
  });
  const locationId = input.locationId || actor.defaultStockLocationId || locations[0]?.id;
  if (!locationId) return { locations, location: null, rows: [], operations: emptyOperations() };
  if (!locations.some((location) => location.id === locationId)) throw new Error('location_forbidden');

  const statusRoles = await getOrderStatusRoleMap();
  const saleStatuses = [...statusRoles.entries()]
    .filter(([, role]) => role === 'SALE')
    .map(([status]) => status);
  const today = resolveRange({ range: 'today' });

  const result = await prisma.$transaction(async (tx) => {
    const location = await assertLocationPermission(tx, actor, locationId, 'view');
    const categories = categoriesForInventoryArea(input.area ?? 'overview');
    const [
      policies,
      todayOrderRows,
      localCashAccounts,
      pendingCounts,
      replenishmentRequests,
      incomingDocuments,
      transitLocation,
      pendingCountTotal,
      replenishmentTotal,
      incomingTransferTotal,
    ] = await Promise.all([
      tx.inventoryLocationPolicy.findMany({
        where: {
          locationId,
          isActive: true,
          ...(categories ? { inventoryItem: { category: { in: [...categories] } } } : {}),
        },
        include: { inventoryItem: true },
        orderBy: { inventoryItem: { nameEn: 'asc' } },
      }),
      tx.order.findMany({
        where: {
          fulfillmentLocationId: locationId,
          purpose: 'SALE',
          status: { in: saleStatuses },
          placedAt: { gte: today.start, lte: today.end },
        },
        select: {
          id: true,
          placedAt: true,
          status: true,
          purpose: true,
          channel: true,
          governorate: true,
          customerId: true,
          currency: true,
          grossAmount: true,
          discountAmount: true,
          refundAmount: true,
          deliveryFee: true,
          extraCharges: true,
          deliveryCost: true,
        },
      }),
      tx.financeAccount.findMany({
        where: locationCashAccountWhere(locationId),
        select: { id: true, name: true, openingBalance: true },
        orderBy: { name: 'asc' },
      }),
      tx.inventoryCount.findMany({
        where: { locationId, status: 'SUBMITTED' },
        select: {
          id: true,
          countNumber: true,
          kind: true,
          countedAt: true,
          submittedBy: { select: { name: true } },
        },
        orderBy: { countedAt: 'asc' },
        take: 10,
      }),
      tx.stockReplenishmentRequest.findMany({
        where: { locationId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        select: {
          id: true,
          requestNumber: true,
          quantity: true,
          status: true,
          version: true,
          createdAt: true,
          notes: true,
          inventoryItem: {
            select: { id: true, nameEn: true, nameAr: true, externalKey: true, unit: true },
          },
          sourceLocation: { select: { id: true, nameEn: true, nameAr: true } },
          order: { select: { id: true, orderNumber: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        take: 20,
      }),
      tx.stockDocument.findMany({
        where: {
          type: 'TRANSFER',
          destinationLocationId: locationId,
          status: { in: ['DISPATCHED', 'PARTIALLY_RECEIVED'] },
        },
        select: {
          id: true,
          documentNumber: true,
          status: true,
          occurredAt: true,
          expectedAt: true,
          sourceLocation: { select: { id: true, nameEn: true, nameAr: true } },
        },
        orderBy: { occurredAt: 'asc' },
        take: 20,
      }),
      tx.stockLocation.findFirst({
        where: {
          branchId: location.branchId,
          type: 'IN_TRANSIT',
          isActive: true,
          isSystem: true,
        },
        select: { id: true },
      }),
      tx.inventoryCount.count({ where: { locationId, status: 'SUBMITTED' } }),
      tx.stockReplenishmentRequest.count({
        where: { locationId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
      tx.stockDocument.count({
        where: {
          type: 'TRANSFER',
          destinationLocationId: locationId,
          status: { in: ['DISPATCHED', 'PARTIALLY_RECEIVED'] },
        },
      }),
    ]);
    const availability = await Promise.all(
      policies.map((policy) => getLocationAvailability(tx, policy.inventoryItemId, locationId)),
    );
    const byItem = new Map(availability.map((row) => [row.inventoryItemId, row]));
    const rows = policies.map((policy) => ({
      policy,
      availability: byItem.get(policy.inventoryItemId)!,
      stockVersion: location.stockVersion,
    }));
    const accountIds = localCashAccounts.map((account) => account.id);
    const financeEntries = accountIds.length
      ? await tx.financeEntry.findMany({
        where: {
          OR: [
            { accountId: { in: accountIds } },
            { toAccountId: { in: accountIds } },
          ],
        },
        select: {
          id: true,
          type: true,
          amount: true,
          currency: true,
          obligation: true,
          obligationKind: true,
          accountId: true,
          toAccountId: true,
          settlesId: true,
          archivedAt: true,
          reversedAt: true,
          reversalOfId: true,
          isOpeningBalance: true,
        },
      })
      : [];
    const accountBalances = localCashAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      balance: accountBalance(account, financeEntries),
    }));
    const incomingTransfers = [];
    for (const document of incomingDocuments) {
      let outstandingQuantity = 0;
      let outstandingItems = 0;
      if (transitLocation) {
        const lots = await outstandingTransferLots(tx, document.id, transitLocation.id);
        outstandingItems = lots.size;
        outstandingQuantity = [...lots.values()].reduce(
          (total, itemLots) => total + itemLots.reduce((sum, lot) => sum + lot.quantity, 0),
          0,
        );
      }
      incomingTransfers.push({ ...document, outstandingQuantity, outstandingItems });
    }
    const metricOrders = todayOrderRows.map((order) => ({ ...order, metricRole: 'SALE' as const }));
    const lowStockTotal = rows.filter(({ policy, availability: stock }) => (
      policy.reorderPoint != null && stock.available <= Number(policy.reorderPoint)
    )).length;
    return {
      rows,
      operations: {
        todaySales: netSales(metricOrders),
        todayOrders: salesOrderCount(metricOrders),
        localCash: summarizeLocationCash(localCashAccounts, financeEntries),
        localCashAccounts: accountBalances,
        pendingCountTotal,
        replenishmentTotal,
        incomingTransferTotal,
        lowStockTotal,
        pendingCounts,
        replenishmentRequests,
        incomingTransfers,
      },
    };
  });
  return {
    locations,
    location: locations.find((location) => location.id === locationId) ?? null,
    rows: result.rows,
    operations: result.operations,
  };
}
