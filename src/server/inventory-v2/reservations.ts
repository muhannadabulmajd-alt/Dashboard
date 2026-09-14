import 'server-only';
import type { CurrentUser } from '@/server/auth/session';
import { decimalNumber, roundMoney } from '@/lib/decimal';
import { prisma } from '@/server/db/client';
import { COMMAND_TRANSACTION_OPTIONS } from '@/server/commands/transaction-checkpoints';
import { requireInventoryV2Enabled } from './config';
import { inventoryCommandError } from './errors';
import {
  assertInventoryCommandReplay,
  inventoryCommandInputHash,
  lockInventoryCommandKey,
} from './idempotency';
import {
  activeReservationQuantity,
  allocateLocationLots,
  assertLocationItemPolicy,
  auditStockCommand,
  bumpLocationVersion,
  lockLocation,
} from './internal';
import { generateStockDocumentNumber } from './numbering';
import {
  ConsumeReservationCommandSchema,
  ReleaseReservationCommandSchema,
  ReserveStockCommandSchema,
  type ConsumeReservationCommandInput,
  type ReleaseReservationCommandInput,
  type ReserveStockCommandInput,
} from './schemas';

export async function reserveFinishedStock(actor: CurrentUser, input: ReserveStockCommandInput) {
  requireInventoryV2Enabled();
  try {
    const command = ReserveStockCommandSchema.parse(input);
    const inputHash = inventoryCommandInputHash('RESERVE_FINISHED_STOCK', actor.id, command);
    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      const replay = await tx.stockReservation.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
      if (replay) {
        assertInventoryCommandReplay(replay.inputHash, inputHash);
        return { reserved: true as const, reservationId: replay.id, replenishmentRequestId: null, replayed: true };
      }
      const replenishmentReplay = await tx.stockReplenishmentRequest.findUnique({
        where: { idempotencyKey: `${command.idempotencyKey}:replenishment` },
      });
      if (replenishmentReplay) {
        assertInventoryCommandReplay(replenishmentReplay.inputHash, inputHash);
        return { reserved: false as const, reservationId: null, replenishmentRequestId: replenishmentReplay.id, replayed: true };
      }

      await lockLocation(tx, actor, command.locationId, 'sell', command.expectedLocationVersion);
      await assertLocationItemPolicy(tx, command.inventoryItemId, command.locationId, 'sell');
      const onHand = await tx.stockMovement.aggregate({
        where: { inventoryItemId: command.inventoryItemId, locationId: command.locationId },
        _sum: { quantity: true },
      });
      const reserved = await activeReservationQuantity(tx, command.inventoryItemId, command.locationId);
      const available = decimalNumber(onHand._sum.quantity) - reserved;
      if (available < command.quantity) {
        const requestNumber = `LHB-RPL-${Date.now().toString(36).toUpperCase()}`;
        const request = await tx.stockReplenishmentRequest.create({
          data: {
            requestNumber,
            inventoryItemId: command.inventoryItemId,
            locationId: command.locationId,
            orderId: command.orderId,
            quantity: (command.quantity - Math.max(0, available)).toFixed(3),
            createdById: actor.id,
            notes: `Insufficient finished stock for order ${command.orderId}`,
            idempotencyKey: `${command.idempotencyKey}:replenishment`,
            inputHash,
          },
        });
        await auditStockCommand(tx, actor, 'REQUEST_REPLENISHMENT', 'StockReplenishmentRequest', request.id, {
          inventoryItemId: command.inventoryItemId,
          locationId: command.locationId,
          orderId: command.orderId,
          requested: command.quantity.toFixed(3),
          available: Math.max(0, available).toFixed(3),
        });
        return { reserved: false as const, reservationId: null, replenishmentRequestId: request.id, replayed: false };
      }

      const reservation = await tx.stockReservation.create({
        data: {
          inventoryItemId: command.inventoryItemId,
          locationId: command.locationId,
          orderId: command.orderId,
          orderLineId: command.orderLineId,
          quantity: command.quantity.toFixed(3),
          expiresAt: command.expiresAt,
          idempotencyKey: command.idempotencyKey,
          inputHash,
          createdById: actor.id,
        },
      });
      await bumpLocationVersion(tx, command.locationId);
      await auditStockCommand(tx, actor, 'RESERVE_STOCK', 'StockReservation', reservation.id, {
        inventoryItemId: command.inventoryItemId,
        locationId: command.locationId,
        orderId: command.orderId,
        orderLineId: command.orderLineId,
        quantity: command.quantity.toFixed(3),
      });
      return { reserved: true as const, reservationId: reservation.id, replenishmentRequestId: null, replayed: false };
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'reserve_stock');
  }
}

export async function consumeFinishedStockReservation(
  actor: CurrentUser,
  input: ConsumeReservationCommandInput,
) {
  requireInventoryV2Enabled();
  try {
    const command = ConsumeReservationCommandSchema.parse(input);
    const inputHash = inventoryCommandInputHash('CONSUME_FINISHED_STOCK_RESERVATION', actor.id, command);
    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      const existingDocument = await tx.stockDocument.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
      });
      if (existingDocument) {
        assertInventoryCommandReplay(existingDocument.inputHash, inputHash);
        if (existingDocument.type !== 'SALE') throw new Error('idempotency_conflict');
        return { stockDocumentId: existingDocument.id, documentNumber: existingDocument.documentNumber, replayed: true };
      }
      const reservation = await tx.stockReservation.findUnique({
        where: { id: command.reservationId },
        include: { order: true, orderLine: true },
      });
      if (!reservation?.order || !reservation.orderLine) throw new Error('reservation_not_found');
      const orderId = reservation.orderId!;
      const orderLineId = reservation.orderLineId!;
      if (reservation.status !== 'ACTIVE') throw new Error('reservation_not_active');
      if (reservation.expiresAt && reservation.expiresAt <= command.occurredAt) throw new Error('reservation_expired');

      const location = await lockLocation(
        tx,
        actor,
        reservation.locationId,
        'sell',
        command.expectedLocationVersion,
      );
      await assertLocationItemPolicy(tx, reservation.inventoryItemId, reservation.locationId, 'sell');
      const quantity = decimalNumber(reservation.quantity);
      const allocations = await allocateLocationLots(tx, reservation.inventoryItemId, reservation.locationId, quantity);
      const documentNumber = await generateStockDocumentNumber(tx, 'SALE', command.occurredAt);
      const document = await tx.stockDocument.create({
        data: {
          documentNumber,
          type: 'SALE',
          status: 'CONFIRMED',
          sourceLocationId: reservation.locationId,
          occurredAt: command.occurredAt,
          confirmedAt: command.occurredAt,
          idempotencyKey: command.idempotencyKey,
          inputHash,
          createdById: actor.id,
          confirmedById: actor.id,
          reason: reservation.order.orderNumber,
        },
      });
      let totalCogs = 0;
      for (const [index, allocation] of allocations.entries()) {
        totalCogs += allocation.quantity * allocation.unitCost;
        await tx.stockMovement.create({
          data: {
            inventoryItemId: reservation.inventoryItemId,
            occurredAt: command.occurredAt,
            reason: 'SOLD',
            quantity: (-allocation.quantity).toFixed(3),
            reference: reservation.order.orderNumber,
            externalId: `inventory-v2:${command.idempotencyKey}:movement:${index + 1}`,
            branchId: location.branchId,
            locationId: reservation.locationId,
            stockDocumentId: document.id,
            costLayerId: allocation.costLayerId,
            orderId,
            orderLineId,
          },
        });
      }
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { status: 'CONSUMED', committedAt: command.occurredAt },
      });
      await tx.orderLine.update({
        where: { id: orderLineId },
        data: { cogsTotalSnapshot: roundMoney(totalCogs) },
      });
      await bumpLocationVersion(tx, reservation.locationId);
      await auditStockCommand(tx, actor, 'CONSUME_STOCK_RESERVATION', 'StockDocument', document.id, {
        reservationId: reservation.id,
        orderId,
        orderLineId,
        quantity: quantity.toFixed(3),
        cogs: roundMoney(totalCogs),
      });
      return { stockDocumentId: document.id, documentNumber, replayed: false };
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'consume_reservation');
  }
}

export async function releaseFinishedStockReservation(
  actor: CurrentUser,
  input: ReleaseReservationCommandInput,
) {
  requireInventoryV2Enabled();
  try {
    const command = ReleaseReservationCommandSchema.parse(input);
    const inputHash = inventoryCommandInputHash('RELEASE_FINISHED_STOCK_RESERVATION', actor.id, command);
    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      const replay = await tx.stockReservation.findUnique({
        where: { releaseIdempotencyKey: command.idempotencyKey },
      });
      if (replay) {
        assertInventoryCommandReplay(replay.releaseInputHash, inputHash);
        if (replay.id !== command.reservationId || replay.status !== 'RELEASED') {
          throw new Error('idempotency_conflict');
        }
        return { reservationId: replay.id, replayed: true };
      }
      const reservation = await tx.stockReservation.findUnique({ where: { id: command.reservationId } });
      if (!reservation) throw new Error('reservation_not_found');
      if (reservation.status !== 'ACTIVE') throw new Error('reservation_not_active');
      await lockLocation(tx, actor, reservation.locationId, 'sell', command.expectedLocationVersion);
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: {
          status: 'RELEASED',
          releasedAt: new Date(),
          releaseIdempotencyKey: command.idempotencyKey,
          releaseInputHash: inputHash,
          releaseReason: command.reason,
          releasedById: actor.id,
        },
      });
      await bumpLocationVersion(tx, reservation.locationId);
      await auditStockCommand(tx, actor, 'RELEASE_STOCK_RESERVATION', 'StockReservation', reservation.id, {
        reason: command.reason,
        idempotencyKey: command.idempotencyKey,
      });
      return { reservationId: reservation.id, replayed: false };
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'release_reservation');
  }
}
