import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/session';
import { decimalNumber, roundMoney } from '@/lib/decimal';
import { prisma } from '@/server/db/client';
import { syncActiveCostForProducts } from '@/server/inventory/fifo';
import { assertLocationPermission } from './access';
import { SELLABLE_INVENTORY_CATEGORIES } from './finished-goods-contracts';
import {
  assertInventoryCommandReplay,
  inventoryCommandInputHash,
  lockInventoryCommandKey,
} from './idempotency';
import { allocateLocationLots, auditStockCommand, bumpLocationVersion, lockLocation } from './internal';
import { generateStockDocumentNumber } from './numbering';

type Tx = Prisma.TransactionClient;

export type OrderStockLine = {
  id: string;
  productId: string;
  sku: string;
  quantity: number;
};

export type OrderStockTarget = 'NONE' | 'RESERVED' | 'CONSUMED';

type TrackedLine = OrderStockLine & { inventoryItemId: string };

export type OrderStockResult = {
  target: OrderStockTarget;
  completed: boolean;
  shortages: Array<{
    inventoryItemId: string;
    sku: string;
    required: number;
    available: number;
    replenishmentRequestId: string;
  }>;
  stockDocumentId: string | null;
  changed: boolean;
};

export function stockTargetForOrderStatusRole(role: string): OrderStockTarget {
  if (role === 'SALE') return 'CONSUMED';
  if (role === 'OPEN') return 'RESERVED';
  return 'NONE';
}

export function orderLineSetsMatch(
  current: Array<{ sku: string; quantity: number; unitGrossPrice: number; lineDiscount: number }>,
  requested: Array<{ sku: string; quantity: number; unitGrossPrice: number; lineDiscount: number }>,
): boolean {
  if (current.length !== requested.length) return false;
  const signature = (line: { sku: string; quantity: number; unitGrossPrice: number; lineDiscount: number }) =>
    `${line.sku}\u0000${line.quantity}\u0000${line.unitGrossPrice}\u0000${line.lineDiscount}`;
  const left = current.map(signature).sort();
  const right = requested.map(signature).sort();
  return left.every((value, index) => value === right[index]);
}

export type OrderLocationOption = {
  id: string;
  stockVersion: number;
  code: string;
  nameEn: string;
  nameAr: string;
  branchNameEn: string;
  branchNameAr: string;
  type: string;
};

function durableKey(prefix: string, ...parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
  return `${prefix}:${digest}`;
}

function quantityKey(value: number): string {
  return value.toFixed(3);
}

async function resolveTrackedLines(
  tx: Tx,
  locationId: string,
  lines: OrderStockLine[],
): Promise<{ trackedLines: TrackedLine[]; trackedProductIds: string[] }> {
  const productIds = [...new Set(lines.map((line) => line.productId))].sort();
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, trackInventory: true, isActive: true },
  });
  if (products.length !== productIds.length || products.some((product) => !product.isActive)) {
    throw new Error('product_inactive');
  }

  const trackedProducts = products.filter((product) => product.trackInventory);
  const trackedProductIds = trackedProducts.map((product) => product.id);
  if (!trackedProductIds.length) return { trackedLines: [], trackedProductIds: [] };

  const items = await tx.inventoryItem.findMany({
    where: {
      productId: { in: trackedProductIds },
      category: { in: [...SELLABLE_INVENTORY_CATEGORIES] },
      isActive: true,
    },
    select: { id: true, productId: true },
    orderBy: { id: 'asc' },
  });
  const itemIdsByProduct = new Map<string, string[]>();
  for (const item of items) {
    if (!item.productId) continue;
    itemIdsByProduct.set(item.productId, [
      ...(itemIdsByProduct.get(item.productId) ?? []),
      item.id,
    ]);
  }
  for (const product of trackedProducts) {
    const linked = itemIdsByProduct.get(product.id) ?? [];
    if (!linked.length) throw new Error(`finished_stock_not_configured:${product.sku}`);
    if (linked.length > 1) throw new Error(`finished_stock_ambiguous:${product.sku}`);
  }

  const policies = await tx.inventoryLocationPolicy.findMany({
    where: {
      locationId,
      inventoryItemId: { in: items.map((item) => item.id) },
      isActive: true,
      canSell: true,
    },
    select: { inventoryItemId: true },
  });
  const allowedItemIds = new Set(policies.map((policy) => policy.inventoryItemId));
  const trackedLines = lines.flatMap((line) => {
    if (!trackedProductIds.includes(line.productId)) return [];
    const inventoryItemId = itemIdsByProduct.get(line.productId)?.[0];
    if (!inventoryItemId) throw new Error(`finished_stock_not_configured:${line.sku}`);
    if (!allowedItemIds.has(inventoryItemId)) {
      throw new Error(`finished_stock_not_sellable_at_location:${line.sku}`);
    }
    return [{ ...line, inventoryItemId }];
  });
  return { trackedLines, trackedProductIds };
}

async function reverseActiveSale(
  tx: Tx,
  actor: CurrentUser,
  input: {
    orderId: string;
    orderNumber: string;
    locationId: string;
    branchId: string;
    occurredAt: Date;
    idempotencyKey: string;
    inputHash: string;
  },
): Promise<{ changed: boolean; stockDocumentId: string | null }> {
  const saleDocuments = await tx.stockDocument.findMany({
    where: {
      type: 'SALE',
      status: { not: 'REVERSED' },
      movements: { some: { orderId: input.orderId, locationId: input.locationId, reason: 'SOLD' } },
    },
    select: {
      id: true,
      movements: {
        where: { orderId: input.orderId, locationId: input.locationId, reason: 'SOLD' },
        select: {
          id: true,
          inventoryItemId: true,
          costLayerId: true,
          orderLineId: true,
          quantity: true,
        },
      },
    },
  });
  if (!saleDocuments.length) return { changed: false, stockDocumentId: null };

  const replay = await tx.stockDocument.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, type: true, inputHash: true },
  });
  if (replay) {
    assertInventoryCommandReplay(replay.inputHash, input.inputHash);
    if (replay.type !== 'REVERSAL') throw new Error('idempotency_conflict');
    return { changed: false, stockDocumentId: replay.id };
  }

  const documentNumber = await generateStockDocumentNumber(tx, 'REVERSAL', input.occurredAt);
  const document = await tx.stockDocument.create({
    data: {
      documentNumber,
      type: 'REVERSAL',
      status: 'CONFIRMED',
      sourceLocationId: input.locationId,
      occurredAt: input.occurredAt,
      confirmedAt: input.occurredAt,
      reason: `Reverse stock for ${input.orderNumber}`,
      idempotencyKey: input.idempotencyKey,
      inputHash: input.inputHash,
      createdById: actor.id,
      confirmedById: actor.id,
    },
  });
  let movementIndex = 0;
  const orderLineIds = new Set<string>();
  for (const saleDocument of saleDocuments) {
    for (const movement of saleDocument.movements) {
      movementIndex += 1;
      if (movement.orderLineId) orderLineIds.add(movement.orderLineId);
      await tx.stockMovement.create({
        data: {
          inventoryItemId: movement.inventoryItemId,
          occurredAt: input.occurredAt,
          reason: 'REVERSAL',
          quantity: Math.abs(decimalNumber(movement.quantity)).toFixed(3),
          reference: input.orderNumber,
          externalId: `${input.idempotencyKey}:movement:${movementIndex}`,
          branchId: input.branchId,
          locationId: input.locationId,
          stockDocumentId: document.id,
          costLayerId: movement.costLayerId,
          orderId: input.orderId,
          orderLineId: movement.orderLineId,
        },
      });
    }
  }
  await tx.stockDocument.updateMany({
    where: { id: { in: saleDocuments.map((row) => row.id) } },
    data: { status: 'REVERSED' },
  });
  if (orderLineIds.size) {
    await tx.orderLine.updateMany({
      where: { id: { in: [...orderLineIds] } },
      data: { cogsTotalSnapshot: null },
    });
  }
  await auditStockCommand(tx, actor, 'REVERSE_ORDER_STOCK', 'StockDocument', document.id, {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    reversedDocumentIds: saleDocuments.map((row) => row.id),
    movementCount: movementIndex,
  });
  return { changed: true, stockDocumentId: document.id };
}

async function releaseActiveReservations(
  tx: Tx,
  orderId: string,
  occurredAt: Date,
): Promise<number> {
  const result = await tx.stockReservation.updateMany({
    where: { orderId, status: 'ACTIVE' },
    data: { status: 'RELEASED', releasedAt: occurredAt },
  });
  return result.count;
}

async function ensureReservations(
  tx: Tx,
  actor: CurrentUser,
  input: {
    orderId: string;
    orderNumber: string;
    locationId: string;
    trackedLines: TrackedLine[];
    occurredAt: Date;
    idempotencyKey: string;
    inputHash: string;
  },
) {
  await tx.stockReservation.updateMany({
    where: {
      orderId: input.orderId,
      status: 'ACTIVE',
      expiresAt: { lte: input.occurredAt },
    },
    data: { status: 'EXPIRED', releasedAt: input.occurredAt },
  });
  const active = await tx.stockReservation.findMany({
    where: { orderId: input.orderId, locationId: input.locationId, status: 'ACTIVE' },
    select: {
      id: true,
      inventoryItemId: true,
      orderLineId: true,
      quantity: true,
    },
  });
  const requestedLineIds = new Set(input.trackedLines.map((line) => line.id));
  const obsolete = active.filter((reservation) => !reservation.orderLineId || !requestedLineIds.has(reservation.orderLineId));
  if (obsolete.length) {
    await tx.stockReservation.updateMany({
      where: { id: { in: obsolete.map((row) => row.id) } },
      data: { status: 'RELEASED', releasedAt: input.occurredAt },
    });
  }
  const current = active.filter((reservation) => !obsolete.some((row) => row.id === reservation.id));

  const requirements = new Map<string, { sku: string; quantity: number; lines: TrackedLine[] }>();
  for (const line of input.trackedLines) {
    const group = requirements.get(line.inventoryItemId) ?? { sku: line.sku, quantity: 0, lines: [] };
    group.quantity += line.quantity;
    group.lines.push(line);
    requirements.set(line.inventoryItemId, group);
  }

  const allActiveReservations = await tx.stockReservation.findMany({
    where: {
      locationId: input.locationId,
      inventoryItemId: { in: [...requirements.keys()] },
      status: 'ACTIVE',
      OR: [{ expiresAt: null }, { expiresAt: { gt: input.occurredAt } }],
    },
    select: { inventoryItemId: true, orderId: true, quantity: true },
  });
  const movements = await tx.stockMovement.groupBy({
    by: ['inventoryItemId'],
    where: { locationId: input.locationId, inventoryItemId: { in: [...requirements.keys()] } },
    _sum: { quantity: true },
  });
  const onHandByItem = new Map(movements.map((row) => [row.inventoryItemId, decimalNumber(row._sum.quantity)]));
  const reservedByOthers = new Map<string, number>();
  for (const reservation of allActiveReservations) {
    if (reservation.orderId === input.orderId) continue;
    reservedByOthers.set(
      reservation.inventoryItemId,
      (reservedByOthers.get(reservation.inventoryItemId) ?? 0) + decimalNumber(reservation.quantity),
    );
  }

  const shortages: OrderStockResult['shortages'] = [];
  let changed = obsolete.length > 0;
  for (const [inventoryItemId, requirement] of requirements) {
    const available = Math.max(
      0,
      (onHandByItem.get(inventoryItemId) ?? 0) - (reservedByOthers.get(inventoryItemId) ?? 0),
    );
    if (available + 1e-9 < requirement.quantity) {
      const itemReservations = current.filter((row) => row.inventoryItemId === inventoryItemId);
      if (itemReservations.length) {
        await tx.stockReservation.updateMany({
          where: { id: { in: itemReservations.map((row) => row.id) } },
          data: { status: 'RELEASED', releasedAt: input.occurredAt },
        });
        changed = true;
      }
      const replenishmentKey = durableKey('order-replenishment', input.idempotencyKey, inventoryItemId);
      const requestNumber = `LHB-RPL-${createHash('sha1').update(replenishmentKey).digest('hex').slice(0, 12).toUpperCase()}`;
      const request = await tx.stockReplenishmentRequest.upsert({
        where: { idempotencyKey: replenishmentKey },
        create: {
          requestNumber,
          inventoryItemId,
          locationId: input.locationId,
          orderId: input.orderId,
          quantity: (requirement.quantity - available).toFixed(3),
          createdById: actor.id,
          notes: `Insufficient finished stock for ${input.orderNumber}`,
          idempotencyKey: replenishmentKey,
          inputHash: input.inputHash,
        },
        update: {},
        select: { id: true, inputHash: true },
      });
      assertInventoryCommandReplay(request.inputHash, input.inputHash);
      shortages.push({
        inventoryItemId,
        sku: requirement.sku,
        required: requirement.quantity,
        available,
        replenishmentRequestId: request.id,
      });
      continue;
    }

    for (const line of requirement.lines) {
      const exact = current.find(
        (reservation) =>
          reservation.orderLineId === line.id &&
          reservation.inventoryItemId === inventoryItemId &&
          Math.abs(decimalNumber(reservation.quantity) - line.quantity) < 1e-9,
      );
      if (exact) continue;
      const prior = current.filter((reservation) => reservation.orderLineId === line.id);
      if (prior.length) {
        await tx.stockReservation.updateMany({
          where: { id: { in: prior.map((row) => row.id) } },
          data: { status: 'RELEASED', releasedAt: input.occurredAt },
        });
      }
      await tx.stockReservation.create({
        data: {
          inventoryItemId,
          locationId: input.locationId,
          orderId: input.orderId,
          orderLineId: line.id,
          quantity: quantityKey(line.quantity),
          idempotencyKey: durableKey('order-reservation', input.idempotencyKey, line.id),
          inputHash: input.inputHash,
          createdById: actor.id,
        },
      });
      changed = true;
    }
  }
  return { shortages, changed };
}

async function consumeReservations(
  tx: Tx,
  actor: CurrentUser,
  input: {
    orderId: string;
    orderNumber: string;
    locationId: string;
    branchId: string;
    trackedLines: TrackedLine[];
    trackedProductIds: string[];
    occurredAt: Date;
    idempotencyKey: string;
    inputHash: string;
  },
): Promise<{ stockDocumentId: string; changed: boolean }> {
  const documentKey = durableKey('order-sale', input.idempotencyKey, input.orderId);
  const replay = await tx.stockDocument.findUnique({
    where: { idempotencyKey: documentKey },
    select: { id: true, type: true, inputHash: true },
  });
  if (replay) {
    assertInventoryCommandReplay(replay.inputHash, input.inputHash);
    if (replay.type !== 'SALE') throw new Error('idempotency_conflict');
    return { stockDocumentId: replay.id, changed: false };
  }

  const reservations = await tx.stockReservation.findMany({
    where: {
      orderId: input.orderId,
      locationId: input.locationId,
      status: 'ACTIVE',
      orderLineId: { in: input.trackedLines.map((line) => line.id) },
    },
    select: { id: true, inventoryItemId: true, orderLineId: true, quantity: true },
  });
  if (reservations.length !== input.trackedLines.length) throw new Error('reservation_incomplete');

  const documentNumber = await generateStockDocumentNumber(tx, 'SALE', input.occurredAt);
  const document = await tx.stockDocument.create({
    data: {
      documentNumber,
      type: 'SALE',
      status: 'CONFIRMED',
      sourceLocationId: input.locationId,
      occurredAt: input.occurredAt,
      confirmedAt: input.occurredAt,
      reason: input.orderNumber,
      idempotencyKey: documentKey,
      inputHash: input.inputHash,
      createdById: actor.id,
      confirmedById: actor.id,
    },
  });
  let movementIndex = 0;
  for (const line of input.trackedLines) {
    const reservation = reservations.find((row) => row.orderLineId === line.id);
    if (!reservation || reservation.inventoryItemId !== line.inventoryItemId) {
      throw new Error('reservation_mismatch');
    }
    const reservedQuantity = decimalNumber(reservation.quantity);
    if (Math.abs(reservedQuantity - line.quantity) > 1e-9) throw new Error('reservation_mismatch');
    const allocations = await allocateLocationLots(tx, line.inventoryItemId, input.locationId, line.quantity);
    let totalCogs = 0;
    for (const allocation of allocations) {
      movementIndex += 1;
      totalCogs += allocation.quantity * allocation.unitCost;
      await tx.stockMovement.create({
        data: {
          inventoryItemId: line.inventoryItemId,
          occurredAt: input.occurredAt,
          reason: 'SOLD',
          quantity: (-allocation.quantity).toFixed(3),
          reference: input.orderNumber,
          externalId: `${documentKey}:movement:${movementIndex}`,
          branchId: input.branchId,
          locationId: input.locationId,
          stockDocumentId: document.id,
          costLayerId: allocation.costLayerId,
          orderId: input.orderId,
          orderLineId: line.id,
        },
      });
    }
    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { status: 'CONSUMED', committedAt: input.occurredAt },
    });
    await tx.orderLine.update({
      where: { id: line.id },
      data: {
        unitCogsSnapshot: line.quantity > 0 ? roundMoney(totalCogs / line.quantity) : 0,
        cogsTotalSnapshot: roundMoney(totalCogs),
      },
    });
  }
  await tx.stockReplenishmentRequest.updateMany({
    where: { orderId: input.orderId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    data: { status: 'FULFILLED' },
  });
  await syncActiveCostForProducts(input.trackedProductIds, tx);
  await auditStockCommand(tx, actor, 'CONSUME_ORDER_STOCK', 'StockDocument', document.id, {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    locationId: input.locationId,
    lineCount: input.trackedLines.length,
    movementCount: movementIndex,
  });
  return { stockDocumentId: document.id, changed: true };
}

export async function resolveOrderLocation(
  tx: Tx,
  actor: CurrentUser,
  requestedLocationId: string | null | undefined,
) {
  const locationId = requestedLocationId || actor.defaultStockLocationId;
  if (!locationId) throw new Error('fulfillment_location_required');
  return assertLocationPermission(tx, actor, locationId, 'sell');
}

export async function listOrderLocations(actor: CurrentUser): Promise<OrderLocationOption[]> {
  const globallyAuthorized = actor.role === 'OWNER' || actor.role === 'ADMIN';
  const rows = await prisma.stockLocation.findMany({
    where: {
      isActive: true,
      ...(globallyAuthorized
        ? {}
        : { userAccesses: { some: { userId: actor.id, canView: true, canSell: true } } }),
    },
    select: {
      id: true,
      stockVersion: true,
      code: true,
      nameEn: true,
      nameAr: true,
      type: true,
      branch: { select: { nameEn: true, nameAr: true } },
    },
    orderBy: [{ branch: { nameEn: 'asc' } }, { nameEn: 'asc' }],
  });
  return rows.map((row) => ({
    id: row.id,
    stockVersion: row.stockVersion,
    code: row.code,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    branchNameEn: row.branch.nameEn,
    branchNameAr: row.branch.nameAr,
    type: row.type,
  }));
}

export async function applyOrderStockTargetInTransaction(
  tx: Tx,
  actor: CurrentUser,
  input: {
    orderId: string;
    orderNumber: string;
    locationId: string;
    lines: OrderStockLine[];
    target: OrderStockTarget;
    occurredAt: Date;
    idempotencyKey: string;
    expectedLocationVersion: number;
  },
): Promise<OrderStockResult> {
  const inputHash = inventoryCommandInputHash('APPLY_ORDER_STOCK_TARGET', actor.id, input);
  await lockInventoryCommandKey(tx, input.idempotencyKey);
  const existingSale = await tx.stockDocument.findFirst({
    where: {
      type: 'SALE',
      status: { not: 'REVERSED' },
      movements: { some: { orderId: input.orderId, locationId: input.locationId, reason: 'SOLD' } },
    },
    select: { id: true },
  });
  if (input.target === 'CONSUMED' && existingSale) {
    return {
      target: input.target,
      completed: true,
      shortages: [],
      stockDocumentId: existingSale.id,
      changed: false,
    };
  }

  const location = await lockLocation(
    tx,
    actor,
    input.locationId,
    'sell',
    input.expectedLocationVersion,
  );
  let changed = false;
  let stockDocumentId: string | null = null;

  if (existingSale && input.target !== 'CONSUMED') {
    const reversal = await reverseActiveSale(tx, actor, {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      locationId: input.locationId,
      branchId: location.branchId,
      occurredAt: input.occurredAt,
      idempotencyKey: durableKey('order-reversal', input.idempotencyKey, input.orderId),
      inputHash,
    });
    changed ||= reversal.changed;
    stockDocumentId = reversal.stockDocumentId;
  }

  if (input.target === 'NONE') {
    const released = await releaseActiveReservations(tx, input.orderId, input.occurredAt);
    changed ||= released > 0;
    if (changed) await bumpLocationVersion(tx, input.locationId);
    await auditStockCommand(tx, actor, 'RELEASE_ORDER_STOCK', 'Order', input.orderId, {
      orderNumber: input.orderNumber,
      locationId: input.locationId,
      releasedReservations: released,
      reversalDocumentId: stockDocumentId,
    });
    return {
      target: input.target,
      completed: true,
      shortages: [],
      stockDocumentId,
      changed,
    };
  }

  const resolved = await resolveTrackedLines(tx, input.locationId, input.lines);
  const reservation = await ensureReservations(tx, actor, {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    locationId: input.locationId,
    trackedLines: resolved.trackedLines,
    occurredAt: input.occurredAt,
    idempotencyKey: input.idempotencyKey,
    inputHash,
  });
  changed ||= reservation.changed;
  if (reservation.shortages.length) {
    if (changed) await bumpLocationVersion(tx, input.locationId);
    await auditStockCommand(tx, actor, 'ORDER_STOCK_SHORTAGE', 'Order', input.orderId, {
      orderNumber: input.orderNumber,
      locationId: input.locationId,
      target: input.target,
      shortages: reservation.shortages,
    });
    return {
      target: input.target,
      completed: false,
      shortages: reservation.shortages,
      stockDocumentId,
      changed,
    };
  }

  if (input.target === 'CONSUMED') {
    const consumed = await consumeReservations(tx, actor, {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      locationId: input.locationId,
      branchId: location.branchId,
      trackedLines: resolved.trackedLines,
      trackedProductIds: resolved.trackedProductIds,
      occurredAt: input.occurredAt,
      idempotencyKey: input.idempotencyKey,
      inputHash,
    });
    changed ||= consumed.changed;
    stockDocumentId = consumed.stockDocumentId;
  }
  if (changed) await bumpLocationVersion(tx, input.locationId);
  await auditStockCommand(tx, actor, input.target === 'CONSUMED' ? 'COMPLETE_ORDER_STOCK' : 'RESERVE_ORDER_STOCK', 'Order', input.orderId, {
    orderNumber: input.orderNumber,
    locationId: input.locationId,
    target: input.target,
    trackedLineCount: resolved.trackedLines.length,
    stockDocumentId,
  });
  return {
    target: input.target,
    completed: true,
    shortages: [],
    stockDocumentId,
    changed,
  };
}
