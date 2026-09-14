import 'server-only';

import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/session';
import { decimalNumber } from '@/lib/decimal';
import {
  hasGlobalLocationAccess,
  stockLocationWhereForPermission,
  type LocationPermission,
} from './access';
import { getLocationAvailability, getLotBalances } from './availability';
import { resolveLocationObjectScope, stockDocumentWhereForScope } from './object-scope';
import { inventoryReadTransaction } from './read-transaction';
import { stockDocumentReversalBlockCode } from './reversals';
import { getReturnedLotBalances } from './returns';

type Tx = Prisma.TransactionClient;

async function locationIdsForPermission(
  tx: Tx,
  actor: CurrentUser,
  permission: LocationPermission,
): Promise<string[]> {
  const rows = await tx.stockLocation.findMany({
    where: {
      isActive: true,
      ...stockLocationWhereForPermission(actor, permission),
    },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

const locationInclude = {
  branch: { select: { code: true, nameEn: true, nameAr: true } },
  policies: {
    where: { isActive: true, inventoryItem: { isActive: true } },
    include: { inventoryItem: true },
    orderBy: { inventoryItem: { nameEn: 'asc' as const } },
  },
} satisfies Prisma.StockLocationInclude;

async function operationLocations(
  tx: Tx,
  actor: CurrentUser,
  permission: LocationPermission,
) {
  return tx.stockLocation.findMany({
    where: {
      isActive: true,
      isSystem: false,
      ...stockLocationWhereForPermission(actor, permission),
    },
    include: locationInclude,
    orderBy: [{ isCentralFulfillment: 'desc' }, { branch: { nameEn: 'asc' } }, { nameEn: 'asc' }],
  });
}

export async function getTransferIndexData(actor: CurrentUser) {
  return inventoryReadTransaction(async (tx) => {
    const [sources, destinations, viewLocationIds, transitLocations] = await Promise.all([
      operationLocations(tx, actor, 'dispatch'),
      operationLocations(tx, actor, 'view'),
      locationIdsForPermission(tx, actor, 'view'),
      tx.stockLocation.findMany({
        where: { type: 'IN_TRANSIT', isSystem: true, isActive: true },
        select: { branchId: true, stockVersion: true },
      }),
    ]);
    const transitVersionByBranch = new Map(
      transitLocations.map((location) => [location.branchId, location.stockVersion]),
    );
    const sourceOptions = await Promise.all(sources.map(async (location) => ({
      ...location,
      transitVersion: transitVersionByBranch.get(location.branchId) ?? null,
      items: await Promise.all(location.policies.map(async (policy) => ({
        ...policy.inventoryItem,
        availability: await getLocationAvailability(tx, policy.inventoryItemId, location.id),
      }))),
    })));
    const documents = await tx.stockDocument.findMany({
      where: {
        type: 'TRANSFER',
        parentDocumentId: null,
        ...(hasGlobalLocationAccess(actor.role) ? {} : {
          OR: [
            { sourceLocationId: { in: viewLocationIds } },
            { destinationLocationId: { in: viewLocationIds } },
          ],
        }),
      },
      include: {
        sourceLocation: { select: { nameEn: true, nameAr: true } },
        destinationLocation: { select: { nameEn: true, nameAr: true } },
        createdBy: { select: { name: true } },
        movements: {
          where: { reason: 'TRANSFER_OUT' },
          select: { inventoryItemId: true, quantity: true },
        },
        _count: { select: { childDocuments: true, discrepancies: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return {
      sources: sourceOptions,
      destinations: destinations.map((location) => ({
        ...location,
        transitVersion: transitVersionByBranch.get(location.branchId) ?? null,
      })),
      documents,
    };
  });
}

export async function getTransferDetailData(actor: CurrentUser, stockDocumentId: string) {
  return inventoryReadTransaction(async (tx) => {
    const document = await tx.stockDocument.findUnique({
      where: { id: stockDocumentId },
      include: {
        sourceLocation: { include: { branch: true } },
        destinationLocation: { include: { branch: true } },
        createdBy: { select: { name: true } },
        confirmedBy: { select: { name: true } },
        movements: {
          include: { inventoryItem: true, costLayer: true },
          orderBy: { createdAt: 'asc' },
        },
        childDocuments: {
          include: {
            createdBy: { select: { name: true } },
            movements: { include: { inventoryItem: true }, orderBy: { createdAt: 'asc' } },
            discrepancies: {
              include: {
                inventoryItem: true,
                resolvedBy: { select: { name: true } },
                resolutionDocument: { select: { id: true, documentNumber: true } },
                financeEntry: { select: { id: true, amount: true, accountingCode: true } },
              },
            },
          },
          orderBy: { occurredAt: 'asc' },
        },
      },
    });
    if (!document || document.type !== 'TRANSFER' || document.parentDocumentId) return null;
    const viewLocationIds = await locationIdsForPermission(tx, actor, 'view');
    if (
      !hasGlobalLocationAccess(actor.role) &&
      ![document.sourceLocationId, document.destinationLocationId].some((id) => id && viewLocationIds.includes(id))
    ) {
      return null;
    }
    if (!document.destinationLocationId || !document.destinationLocation) return null;
    const transit = await tx.stockLocation.findFirst({
      where: {
        branchId: document.destinationLocation.branchId,
        type: 'IN_TRANSIT',
        isSystem: true,
        isActive: true,
      },
      select: { id: true, stockVersion: true },
    });
    if (!transit) return { document, outstanding: [], canReceive: false, transit: null };
    const documentIds = [document.id, ...document.childDocuments.map((child) => child.id)];
    const balances = await tx.stockMovement.groupBy({
      by: ['inventoryItemId'],
      where: { stockDocumentId: { in: documentIds }, locationId: transit.id },
      _sum: { quantity: true },
    });
    const outstandingBalances = balances
      .map((row) => ({ inventoryItemId: row.inventoryItemId, quantity: decimalNumber(row._sum.quantity) }))
      .filter((row) => row.quantity > 1e-9);
    const items = await tx.inventoryItem.findMany({
      where: { id: { in: outstandingBalances.map((row) => row.inventoryItemId) } },
      select: { id: true, nameEn: true, nameAr: true, unit: true },
    });
    const itemById = new Map(items.map((item) => [item.id, item]));
    const receiveLocationIds = await locationIdsForPermission(tx, actor, 'receive');
    return {
      document,
      transit,
      canReceive: hasGlobalLocationAccess(actor.role) || receiveLocationIds.includes(document.destinationLocationId),
      canResolveDiscrepancies: actor.role === 'OWNER' || actor.role === 'ADMIN',
      outstanding: outstandingBalances.flatMap((row) => {
        const item = itemById.get(row.inventoryItemId);
        return item ? [{ ...item, quantity: row.quantity }] : [];
      }),
    };
  });
}

export async function getStockDocumentDetailData(actor: CurrentUser, stockDocumentId: string) {
  return inventoryReadTransaction(async (tx) => {
    const scope = await resolveLocationObjectScope(actor, tx);
    const document = await tx.stockDocument.findFirst({
      where: { id: stockDocumentId, ...stockDocumentWhereForScope(scope) },
      include: {
        sourceLocation: { include: { branch: true } },
        destinationLocation: { include: { branch: true } },
        createdBy: { select: { name: true } },
        confirmedBy: { select: { name: true } },
        party: { select: { name: true } },
        parentDocument: { select: { id: true, documentNumber: true, type: true } },
        childDocuments: {
          select: { id: true, documentNumber: true, type: true, status: true },
          orderBy: { occurredAt: 'asc' },
        },
        reversalOf: { select: { id: true, documentNumber: true, type: true } },
        reversedByDocument: { select: { id: true, documentNumber: true, type: true, status: true } },
        movements: {
          include: {
            inventoryItem: true,
            location: { include: { branch: true } },
            costLayer: true,
            financeEntry: { select: { id: true, recordKey: true, reference: true } },
            order: { select: { id: true, orderNumber: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        discrepancies: { select: { id: true } },
        discrepancyResolutions: { select: { id: true } },
        inventoryCount: { select: { id: true } },
      },
    });
    if (!document) return null;
    const shape = {
      type: document.type,
      status: document.status,
      parentType: document.parentDocument?.type ?? null,
      activeChildCount: document.childDocuments.filter(
        (child) => child.type !== 'REVERSAL' && child.status !== 'REVERSED',
      ).length,
      discrepancyCount: document.discrepancies.length,
      discrepancyResolutionCount: document.discrepancyResolutions.length,
      hasInventoryCount: Boolean(document.inventoryCount),
    };
    const ownerAdmin = actor.role === 'OWNER' || actor.role === 'ADMIN';
    const reversalBlockCode = ownerAdmin
      ? stockDocumentReversalBlockCode(shape)
      : 'stock_document_reversal_forbidden';
    const expectedLocationVersions = [...new Map(document.movements.flatMap((movement) => (
      movement.location
        ? [[movement.location.id, {
            locationId: movement.location.id,
            stockVersion: movement.location.stockVersion,
          }] as const]
        : []
    ))).values()];
    return {
      document,
      expectedLocationVersions,
      reversalBlockCode: expectedLocationVersions.length
        ? reversalBlockCode
        : reversalBlockCode ?? 'stock_document_location_missing',
      canReverse: ownerAdmin && !reversalBlockCode && expectedLocationVersions.length > 0,
    };
  });
}

export async function getCountIndexData(actor: CurrentUser) {
  return inventoryReadTransaction(async (tx) => {
    const [locations, viewLocationIds] = await Promise.all([
      operationLocations(tx, actor, 'count'),
      locationIdsForPermission(tx, actor, 'view'),
    ]);
    const countLocations = await Promise.all(locations.map(async (location) => ({
      ...location,
      items: await Promise.all(location.policies.map(async (policy) => ({
        ...policy.inventoryItem,
        availability: await getLocationAvailability(tx, policy.inventoryItemId, location.id),
      }))),
    })));
    const counts = await tx.inventoryCount.findMany({
      where: hasGlobalLocationAccess(actor.role) ? {} : { locationId: { in: viewLocationIds } },
      include: {
        location: { select: { nameEn: true, nameAr: true } },
        submittedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        rejectedBy: { select: { name: true } },
        _count: { select: { lines: true } },
      },
      orderBy: [{ countedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return { locations: countLocations, counts };
  });
}

export async function getCountDetailData(actor: CurrentUser, inventoryCountId: string) {
  return inventoryReadTransaction(async (tx) => {
    const count = await tx.inventoryCount.findUnique({
      where: { id: inventoryCountId },
      include: {
        location: { include: { branch: true } },
        submittedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        rejectedBy: { select: { name: true } },
        stockDocument: true,
        financeEntries: {
          select: {
            id: true,
            type: true,
            amount: true,
            accountingCode: true,
            isOpeningBalance: true,
          },
          orderBy: { type: 'asc' },
        },
        lines: { include: { inventoryItem: true }, orderBy: { inventoryItem: { nameEn: 'asc' } } },
      },
    });
    if (!count) return null;
    const viewLocationIds = await locationIdsForPermission(tx, actor, 'view');
    if (!hasGlobalLocationAccess(actor.role) && !viewLocationIds.includes(count.locationId)) return null;
    return {
      count,
      canApprove: (actor.role === 'OWNER' || actor.role === 'ADMIN') && count.status === 'SUBMITTED',
      canReject: (actor.role === 'OWNER' || actor.role === 'ADMIN') && count.status === 'SUBMITTED',
    };
  });
}

export async function getLotsViewData(actor: CurrentUser, requestedLocationId?: string) {
  return inventoryReadTransaction(async (tx) => {
    const locations = await operationLocations(tx, actor, 'view');
    const location = locations.find((row) => row.id === requestedLocationId)
      ?? locations.find((row) => row.id === actor.defaultStockLocationId)
      ?? locations[0]
      ?? null;
    if (!location) return { locations, location: null, lots: [] };
    const lots = (await Promise.all(location.policies.map(async (policy) => {
      const balances = await getLotBalances(tx, policy.inventoryItemId, location.id);
      return balances.map((balance) => ({
        ...balance,
        inventoryItem: policy.inventoryItem,
      }));
    }))).flat().filter((lot) => lot.quantity > 1e-9);
    return { locations, location, lots };
  });
}

export async function getMovementHistoryData(actor: CurrentUser, requestedLocationId?: string) {
  return inventoryReadTransaction(async (tx) => {
    const locations = await operationLocations(tx, actor, 'view');
    const location = locations.find((row) => row.id === requestedLocationId)
      ?? locations.find((row) => row.id === actor.defaultStockLocationId)
      ?? locations[0]
      ?? null;
    if (!location) return { locations, location: null, movements: [] };
    const movements = await tx.stockMovement.findMany({
      where: { locationId: location.id },
      include: {
        inventoryItem: true,
        stockDocument: { select: { id: true, documentNumber: true, type: true } },
        order: { select: { id: true, orderNumber: true } },
        costLayer: { select: { lotNumber: true, unitCost: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 250,
    });
    return { locations, location, movements };
  });
}

export async function getPackingIndexData(actor: CurrentUser) {
  return inventoryReadTransaction(async (tx) => {
    const [locations, viewLocationIds, activeRecipes] = await Promise.all([
      operationLocations(tx, actor, 'produce'),
      locationIdsForPermission(tx, actor, 'view'),
      tx.productRecipeVersion.findMany({
        where: { isActive: true, product: { isActive: true } },
        include: { product: true, components: true },
        orderBy: [{ product: { sku: 'asc' } }, { version: 'desc' }],
      }),
    ]);
    const recipeByProduct = new Map(activeRecipes.map((recipe) => [recipe.productId, recipe]));
    const packingLocations = await Promise.all(locations.map(async (location) => ({
      ...location,
      outputs: (await Promise.all(location.policies
        .filter((policy) => (
          policy.canSell &&
          policy.inventoryItem.productId &&
          ['FINISHED_GOOD', 'ACCESSORY'].includes(policy.inventoryItem.category)
        ))
        .map(async (policy) => {
          const recipe = recipeByProduct.get(policy.inventoryItem.productId!);
          if (!recipe) return null;
          return {
            inventoryItem: policy.inventoryItem,
            recipe,
            availability: await getLocationAvailability(tx, policy.inventoryItemId, location.id),
          };
        }))).filter((row): row is NonNullable<typeof row> => row !== null),
    })));
    const batches = await tx.packingBatch.findMany({
      where: hasGlobalLocationAccess(actor.role) ? {} : { locationId: { in: viewLocationIds } },
      include: {
        location: { select: { nameEn: true, nameAr: true } },
        product: { select: { sku: true, nameEn: true, nameAr: true } },
        outputInventoryItem: { select: { unit: true } },
        operator: { select: { name: true } },
      },
      orderBy: [{ packedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return { locations: packingLocations, batches };
  });
}

export async function getPackingDetailData(actor: CurrentUser, packingBatchId: string) {
  return inventoryReadTransaction(async (tx) => {
    const batch = await tx.packingBatch.findUnique({
      where: { id: packingBatchId },
      include: {
        location: { include: { branch: true } },
        product: true,
        outputInventoryItem: true,
        outputLot: true,
        operator: { select: { name: true } },
        recipeVersion: true,
        stockDocument: { include: { movements: { include: { inventoryItem: true, costLayer: true } } } },
        components: {
          include: { inventoryItem: true, costLayer: true },
          orderBy: { inventoryItem: { nameEn: 'asc' } },
        },
      },
    });
    if (!batch) return null;
    const viewLocationIds = await locationIdsForPermission(tx, actor, 'view');
    if (!hasGlobalLocationAccess(actor.role) && !viewLocationIds.includes(batch.locationId)) return null;
    return batch;
  });
}

export async function getRoastFormData(actor: CurrentUser) {
  return inventoryReadTransaction(async (tx) => {
    const locations = await operationLocations(tx, actor, 'produce');
    return Promise.all(locations.map(async (location) => ({
      ...location,
      greenItems: await Promise.all(location.policies
        .filter((policy) => policy.canProduce && policy.inventoryItem.category === 'GREEN_COFFEE')
        .map(async (policy) => ({
          ...policy.inventoryItem,
          availability: await getLocationAvailability(tx, policy.inventoryItemId, location.id),
        }))),
      roastedItems: location.policies
        .filter((policy) => policy.canProduce && policy.inventoryItem.category === 'ROASTED')
        .map((policy) => policy.inventoryItem),
    })));
  });
}

export async function getReturnIndexData(actor: CurrentUser) {
  return inventoryReadTransaction(async (tx) => {
    const viewLocationIds = await locationIdsForPermission(tx, actor, 'view');
    const documents = await tx.stockDocument.findMany({
      where: {
        type: 'RETURN',
        parentDocumentId: null,
        destinationLocation: { type: 'QUARANTINE' },
        ...(hasGlobalLocationAccess(actor.role)
          ? {}
          : { destinationLocationId: { in: viewLocationIds } }),
      },
      include: {
        sourceLocation: { select: { nameEn: true, nameAr: true } },
        destinationLocation: { select: { nameEn: true, nameAr: true } },
        createdBy: { select: { name: true } },
        movements: {
          where: { reason: 'QUARANTINE', quantity: { gt: 0 } },
          include: {
            inventoryItem: { select: { id: true, nameEn: true, nameAr: true, unit: true } },
            order: { select: { id: true, orderNumber: true } },
          },
        },
        _count: { select: { childDocuments: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    const rows = await Promise.all(documents.map(async (document) => {
      const state = await getReturnedLotBalances(tx, document.id);
      return {
        document,
        outstandingQuantity: state.lots.reduce((sum, lot) => sum + lot.quantity, 0),
        returnedQuantity: document.movements.reduce(
          (sum, movement) => sum + decimalNumber(movement.quantity),
          0,
        ),
      };
    }));
    return rows;
  });
}

export async function getReturnDetailData(actor: CurrentUser, returnDocumentId: string) {
  return inventoryReadTransaction(async (tx) => {
    const document = await tx.stockDocument.findUnique({
      where: { id: returnDocumentId },
      include: {
        sourceLocation: { include: { branch: true } },
        destinationLocation: { include: { branch: true } },
        createdBy: { select: { name: true } },
        movements: {
          where: { reason: 'QUARANTINE', quantity: { gt: 0 } },
          include: {
            inventoryItem: true,
            costLayer: true,
            order: { select: { id: true, orderNumber: true } },
            orderLine: { select: { id: true, sku: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        childDocuments: {
          include: {
            destinationLocation: { select: { nameEn: true, nameAr: true } },
            party: { select: { name: true } },
            createdBy: { select: { name: true } },
            movements: { where: { quantity: { lt: 0 } }, select: { quantity: true } },
          },
          orderBy: { occurredAt: 'asc' },
        },
      },
    });
    if (
      !document
      || document.type !== 'RETURN'
      || document.parentDocumentId
      || document.destinationLocation?.type !== 'QUARANTINE'
      || !document.destinationLocationId
    ) {
      return null;
    }
    const viewLocationIds = await locationIdsForPermission(tx, actor, 'view');
    if (!hasGlobalLocationAccess(actor.role) && !viewLocationIds.includes(document.destinationLocationId)) {
      return null;
    }
    const state = await getReturnedLotBalances(tx, document.id);
    const itemIds = [...new Set(state.lots.map((lot) => lot.inventoryItemId))];
    const items = await tx.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, nameEn: true, nameAr: true, unit: true },
    });
    const itemById = new Map(items.map((item) => [item.id, item]));
    const canDispose = actor.role === 'OWNER' || actor.role === 'ADMIN';
    const destinationLocations = canDispose
      ? (await operationLocations(tx, actor, 'approve')).filter(
          (location) => location.branchId === state.document.branchId,
        )
      : [];
    const suppliers = canDispose
      ? await tx.party.findMany({
          where: { type: 'SUPPLIER', isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : [];
    return {
      document,
      canDispose,
      quarantineStockVersion: document.destinationLocation.stockVersion,
      returnDocumentVersion: state.document.version,
      outstanding: state.lots.flatMap((lot) => {
        const item = itemById.get(lot.inventoryItemId);
        return item ? [{ ...lot, inventoryItem: item }] : [];
      }),
      destinationLocations,
      suppliers,
    };
  });
}

export async function getOrderReturnOptions(actor: CurrentUser, orderId: string) {
  return inventoryReadTransaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        fulfillmentLocationId: true,
        fulfillmentLocation: {
          select: { id: true, branchId: true, stockVersion: true, nameEn: true, nameAr: true },
        },
        lines: { select: { id: true, sku: true, product: { select: { nameEn: true, nameAr: true } } } },
      },
    });
    if (!order?.fulfillmentLocationId || !order.fulfillmentLocation) return null;
    const receiveLocationIds = await locationIdsForPermission(tx, actor, 'receive');
    const canReturn = hasGlobalLocationAccess(actor.role)
      || receiveLocationIds.includes(order.fulfillmentLocationId);
    if (!canReturn) return null;
    const quarantine = await tx.stockLocation.findFirst({
      where: {
        branchId: order.fulfillmentLocation.branchId,
        type: 'QUARANTINE',
        isSystem: true,
        isActive: true,
      },
      select: { id: true, stockVersion: true },
    });
    if (!quarantine) return null;
    const [sold, returned] = await Promise.all([
      tx.stockMovement.groupBy({
        by: ['orderLineId', 'inventoryItemId'],
        where: { orderId, orderLineId: { not: null }, reason: 'SOLD' },
        _sum: { quantity: true },
      }),
      tx.stockMovement.groupBy({
        by: ['orderLineId', 'inventoryItemId'],
        where: { orderId, orderLineId: { not: null }, reason: 'QUARANTINE' },
        _sum: { quantity: true },
      }),
    ]);
    const returnedByLine = new Map(returned.map((row) => [
      `${row.orderLineId}:${row.inventoryItemId}`,
      decimalNumber(row._sum.quantity),
    ]));
    const lineById = new Map(order.lines.map((line) => [line.id, line]));
    const lines = sold.flatMap((row) => {
      if (!row.orderLineId) return [];
      const line = lineById.get(row.orderLineId);
      if (!line) return [];
      const soldQuantity = Math.max(0, -decimalNumber(row._sum.quantity));
      const returnedQuantity = returnedByLine.get(`${row.orderLineId}:${row.inventoryItemId}`) ?? 0;
      const returnableQuantity = Number(Math.max(0, soldQuantity - returnedQuantity).toFixed(3));
      return returnableQuantity > 0 ? [{
        orderLineId: line.id,
        inventoryItemId: row.inventoryItemId,
        sku: line.sku,
        nameEn: line.product.nameEn,
        nameAr: line.product.nameAr,
        returnableQuantity,
      }] : [];
    });
    return {
      order,
      quarantine,
      lines,
    };
  });
}
