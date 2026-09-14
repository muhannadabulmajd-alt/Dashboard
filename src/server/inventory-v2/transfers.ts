import 'server-only';
import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/session';
import { decimalNumber } from '@/lib/decimal';
import { prisma } from '@/server/db/client';
import { COMMAND_TRANSACTION_OPTIONS } from '@/server/commands/transaction-checkpoints';
import type {
  CommandCommitHook,
  CommandPreconditionHook,
} from '@/server/records/shared';
import { requireInventoryV2Enabled } from './config';
import { inventoryCommandError } from './errors';
import {
  assertInventoryCommandReplay,
  inventoryCommandInputHash,
  lockInventoryCommandKey,
} from './idempotency';
import {
  allocateLocationLots,
  assertLocationItemPolicy,
  auditStockCommand,
  bumpLocationVersion,
  lockLocation,
} from './internal';
import { selectLotAllocations, type AvailableLot } from './lot-allocation';
import { generateStockDocumentNumber } from './numbering';
import {
  DispatchTransferCommandSchema,
  ReceiveTransferCommandSchema,
  type DispatchTransferCommandInput,
  type ReceiveTransferCommandInput,
} from './schemas';

type Tx = Prisma.TransactionClient;

export type DispatchStockTransferResult = {
  stockDocumentId: string;
  documentNumber: string;
  sourceLocationId: string;
  destinationLocationId: string;
  sourceStockVersion: number;
  transitStockVersion: number;
  replayed: boolean;
};

export type ReceiveStockTransferResult = {
  receiptDocumentId: string;
  documentNumber: string;
  dispatchStatus: 'RECEIVED' | 'PARTIALLY_RECEIVED';
  destinationLocationId: string;
  transitStockVersion: number;
  destinationStockVersion: number;
  replayed: boolean;
};

type CommandOptions<TResult> = {
  beforeExecute?: CommandPreconditionHook;
  onCommitted?: CommandCommitHook<TResult>;
};

export function consolidateTransferLines(
  lines: Array<{ inventoryItemId: string; quantity: number }>,
): Array<{ inventoryItemId: string; quantity: number }> {
  const quantities = new Map<string, number>();
  for (const line of lines) {
    quantities.set(
      line.inventoryItemId,
      Number(((quantities.get(line.inventoryItemId) ?? 0) + line.quantity).toFixed(3)),
    );
  }
  return [...quantities.entries()]
    .map(([inventoryItemId, quantity]) => ({ inventoryItemId, quantity }))
    .sort((left, right) => left.inventoryItemId.localeCompare(right.inventoryItemId));
}

export function validateTransferReceiptEvidence(
  outstanding: Array<{ inventoryItemId: string; quantity: number }>,
  received: Array<{ inventoryItemId: string; quantity: number }>,
  discrepancies: Array<{ inventoryItemId: string; type: 'SHORTAGE' | 'DAMAGE' | 'EXCESS'; quantity: number }>,
): void {
  const outstandingByItem = new Map(outstanding.map((row) => [row.inventoryItemId, row.quantity]));
  const receivedByItem = new Map(consolidateTransferLines(received).map((row) => [row.inventoryItemId, row.quantity]));

  for (const [inventoryItemId, receivedQuantity] of receivedByItem) {
    const available = outstandingByItem.get(inventoryItemId);
    if (available === undefined || receivedQuantity - available > 0.0005) {
      throw new Error('transfer_receipt_exceeds_dispatch');
    }
  }
  for (const discrepancy of discrepancies) {
    const available = outstandingByItem.get(discrepancy.inventoryItemId);
    if (available === undefined) throw new Error('transfer_discrepancy_item_invalid');
    if (discrepancy.type !== 'EXCESS') {
      const receivedQuantity = receivedByItem.get(discrepancy.inventoryItemId) ?? 0;
      if (receivedQuantity + discrepancy.quantity - available > 0.0005) {
        throw new Error('transfer_discrepancy_exceeds_outstanding');
      }
    }
  }
}

async function findTransitLocation(tx: Tx, destinationLocationId: string) {
  const destination = await tx.stockLocation.findUnique({
    where: { id: destinationLocationId },
    select: { id: true, branchId: true, isActive: true, isSystem: true },
  });
  if (!destination?.isActive || destination.isSystem) throw new Error('transfer_destination_invalid');
  const transit = await tx.stockLocation.findFirst({
    where: { branchId: destination.branchId, type: 'IN_TRANSIT', isActive: true, isSystem: true },
    select: { id: true, branchId: true, stockVersion: true },
  });
  if (!transit) throw new Error('transit_location_missing');
  return { destination, transit };
}

async function lockTransitLocation(tx: Tx, transitId: string, expectedVersion: number) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "StockLocation" WHERE "id" = ${transitId} FOR UPDATE
  `;
  const transit = await tx.stockLocation.findUnique({
    where: { id: transitId },
    select: { id: true, stockVersion: true, isActive: true },
  });
  if (!transit?.isActive) throw new Error('transit_location_missing');
  if (transit.stockVersion !== expectedVersion) throw new Error('location_stale');
  return transit;
}

export async function dispatchStockTransfer(
  actor: CurrentUser,
  input: DispatchTransferCommandInput,
  options: CommandOptions<DispatchStockTransferResult> = {},
): Promise<DispatchStockTransferResult> {
  requireInventoryV2Enabled();
  try {
    const command = DispatchTransferCommandSchema.parse(input);
    if (command.sourceLocationId === command.destinationLocationId) throw new Error('transfer_same_location');
    const lines = consolidateTransferLines(command.lines);
    const inputHash = inventoryCommandInputHash('DISPATCH_STOCK_TRANSFER', actor.id, command);

    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      await options.beforeExecute?.(tx);
      const replay = await tx.stockDocument.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
        include: {
          movements: {
            where: { reason: 'TRANSFER_OUT' },
            select: { inventoryItemId: true, quantity: true },
          },
        },
      });
      if (replay) {
        assertInventoryCommandReplay(replay.inputHash, inputHash);
        const replayLines = consolidateTransferLines(replay.movements.map((movement) => ({
          inventoryItemId: movement.inventoryItemId,
          quantity: Math.abs(decimalNumber(movement.quantity)),
        })));
        if (
          replay.type !== 'TRANSFER'
          || replay.sourceLocationId !== command.sourceLocationId
          || replay.destinationLocationId !== command.destinationLocationId
          || replay.occurredAt.getTime() !== command.occurredAt.getTime()
          || (replay.expectedAt?.getTime() ?? null) !== (command.expectedAt?.getTime() ?? null)
          || JSON.stringify(replayLines) !== JSON.stringify(lines)
        ) {
          throw new Error('idempotency_conflict');
        }
        const { transit } = await findTransitLocation(tx, command.destinationLocationId);
        const [source, currentTransit] = await Promise.all([
          tx.stockLocation.findUniqueOrThrow({ where: { id: command.sourceLocationId }, select: { stockVersion: true } }),
          tx.stockLocation.findUniqueOrThrow({ where: { id: transit.id }, select: { stockVersion: true } }),
        ]);
        const result = {
          stockDocumentId: replay.id,
          documentNumber: replay.documentNumber,
          sourceLocationId: command.sourceLocationId,
          destinationLocationId: command.destinationLocationId,
          sourceStockVersion: source.stockVersion,
          transitStockVersion: currentTransit.stockVersion,
          replayed: true,
        };
        await options.onCommitted?.(tx, result);
        return result;
      }

      const { destination, transit } = await findTransitLocation(tx, command.destinationLocationId);
      const source = await lockLocation(
        tx,
        actor,
        command.sourceLocationId,
        'dispatch',
        command.expectedSourceVersion,
      );
      await lockTransitLocation(tx, transit.id, command.expectedTransitVersion);
      const allocationsByItem = new Map<string, Awaited<ReturnType<typeof allocateLocationLots>>>();
      for (const line of lines) {
        await assertLocationItemPolicy(tx, line.inventoryItemId, source.id);
        await assertLocationItemPolicy(tx, line.inventoryItemId, destination.id);
        allocationsByItem.set(
          line.inventoryItemId,
          await allocateLocationLots(tx, line.inventoryItemId, source.id, line.quantity),
        );
      }

      const documentNumber = await generateStockDocumentNumber(tx, 'TRANSFER', command.occurredAt);
      const document = await tx.stockDocument.create({
        data: {
          documentNumber,
          type: 'TRANSFER',
          status: 'DISPATCHED',
          sourceLocationId: source.id,
          destinationLocationId: destination.id,
          occurredAt: command.occurredAt,
          expectedAt: command.expectedAt,
          notes: command.notes,
          idempotencyKey: command.idempotencyKey,
          inputHash,
          createdById: actor.id,
          confirmedById: actor.id,
          confirmedAt: command.occurredAt,
        },
      });
      let movementIndex = 0;
      for (const line of lines) {
        for (const allocation of allocationsByItem.get(line.inventoryItemId) ?? []) {
          movementIndex += 1;
          const shared = {
            inventoryItemId: line.inventoryItemId,
            occurredAt: command.occurredAt,
            stockDocumentId: document.id,
            costLayerId: allocation.costLayerId,
            reference: documentNumber,
          };
          await tx.stockMovement.createMany({
            data: [
              {
                ...shared,
                reason: 'TRANSFER_OUT',
                quantity: (-allocation.quantity).toFixed(3),
                branchId: source.branchId,
                locationId: source.id,
                externalId: `inventory-v2:${command.idempotencyKey}:out:${movementIndex}`,
              },
              {
                ...shared,
                reason: 'TRANSFER_IN',
                quantity: allocation.quantity.toFixed(3),
                branchId: transit.branchId,
                locationId: transit.id,
                externalId: `inventory-v2:${command.idempotencyKey}:transit:${movementIndex}`,
              },
            ],
          });
        }
      }
      const [sourceStockVersion, transitStockVersion] = await Promise.all([
        bumpLocationVersion(tx, source.id),
        bumpLocationVersion(tx, transit.id),
      ]);
      await auditStockCommand(tx, actor, 'DISPATCH_STOCK_TRANSFER', 'StockDocument', document.id, {
        documentNumber,
        sourceLocationId: source.id,
        destinationLocationId: destination.id,
        transitLocationId: transit.id,
        lines: lines.map((line) => ({
          inventoryItemId: line.inventoryItemId,
          quantity: line.quantity.toFixed(3),
        })),
      });
      const result = {
        stockDocumentId: document.id,
        documentNumber,
        sourceLocationId: source.id,
        destinationLocationId: destination.id,
        sourceStockVersion,
        transitStockVersion,
        replayed: false,
      };
      await options.onCommitted?.(tx, result);
      return result;
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'dispatch_transfer');
  }
}

export async function outstandingTransferLots(
  tx: Tx,
  dispatchDocumentId: string,
  transitLocationId: string,
) {
  const children = await tx.stockDocument.findMany({
    where: { parentDocumentId: dispatchDocumentId },
    select: { id: true },
  });
  const documentIds = [dispatchDocumentId, ...children.map((row) => row.id)];
  const balances = await tx.stockMovement.groupBy({
    by: ['inventoryItemId', 'costLayerId'],
    where: {
      stockDocumentId: { in: documentIds },
      locationId: transitLocationId,
    },
    _sum: { quantity: true },
  });
  const layerIds = balances.flatMap((row) => row.costLayerId ? [row.costLayerId] : []);
  const layers = await tx.inventoryCostLayer.findMany({
    where: { id: { in: layerIds } },
    select: { id: true, unitCost: true, receivedAt: true, bestBefore: true },
  });
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const result = new Map<string, AvailableLot[]>();
  for (const row of balances) {
    if (!row.costLayerId) throw new Error('transfer_lot_missing');
    const layer = byId.get(row.costLayerId);
    if (!layer) throw new Error('transfer_lot_missing');
    const quantity = decimalNumber(row._sum.quantity);
    if (quantity <= 0) continue;
    result.set(row.inventoryItemId, [
      ...(result.get(row.inventoryItemId) ?? []),
      {
        id: layer.id,
        quantity,
        unitCost: decimalNumber(layer.unitCost),
        receivedAt: layer.receivedAt,
        bestBefore: layer.bestBefore,
      },
    ]);
  }
  return result;
}

export async function receiveStockTransfer(
  actor: CurrentUser,
  input: ReceiveTransferCommandInput,
  options: CommandOptions<ReceiveStockTransferResult> = {},
): Promise<ReceiveStockTransferResult> {
  requireInventoryV2Enabled();
  try {
    const command = ReceiveTransferCommandSchema.parse(input);
    const lines = consolidateTransferLines(command.lines);
    const inputHash = inventoryCommandInputHash('RECEIVE_STOCK_TRANSFER', actor.id, command);
    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      await options.beforeExecute?.(tx);
      const replay = await tx.stockDocument.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
        include: {
          movements: {
            where: { reason: 'TRANSFER_IN' },
            select: { inventoryItemId: true, quantity: true },
          },
          discrepancies: {
            select: { inventoryItemId: true, type: true, quantity: true, notes: true },
          },
        },
      });
      if (replay) {
        assertInventoryCommandReplay(replay.inputHash, inputHash);
        const replayLines = consolidateTransferLines(replay.movements.map((movement) => ({
          inventoryItemId: movement.inventoryItemId,
          quantity: decimalNumber(movement.quantity),
        })));
        const replayDiscrepancies = replay.discrepancies
          .map((row) => ({
            inventoryItemId: row.inventoryItemId,
            type: row.type,
            quantity: decimalNumber(row.quantity),
            notes: row.notes,
          }))
          .sort((left, right) => left.inventoryItemId.localeCompare(right.inventoryItemId));
        const commandDiscrepancies = [...command.discrepancies]
          .sort((left, right) => left.inventoryItemId.localeCompare(right.inventoryItemId));
        if (replay.type !== 'TRANSFER' || replay.parentDocumentId !== command.stockDocumentId) {
          throw new Error('idempotency_conflict');
        }
        if (
          replay.destinationLocationId !== command.destinationLocationId
          || replay.occurredAt.getTime() !== command.occurredAt.getTime()
          || JSON.stringify(replayLines) !== JSON.stringify(lines)
          || JSON.stringify(replayDiscrepancies) !== JSON.stringify(commandDiscrepancies)
        ) {
          throw new Error('idempotency_conflict');
        }
        const { transit } = await findTransitLocation(tx, command.destinationLocationId);
        const [dispatch, currentTransit, destination] = await Promise.all([
          tx.stockDocument.findUniqueOrThrow({ where: { id: command.stockDocumentId }, select: { status: true } }),
          tx.stockLocation.findUniqueOrThrow({ where: { id: transit.id }, select: { stockVersion: true } }),
          tx.stockLocation.findUniqueOrThrow({ where: { id: command.destinationLocationId }, select: { stockVersion: true } }),
        ]);
        if (!['RECEIVED', 'PARTIALLY_RECEIVED'].includes(dispatch.status)) {
          throw new Error('idempotency_result_incomplete');
        }
        const result = {
          receiptDocumentId: replay.id,
          documentNumber: replay.documentNumber,
          dispatchStatus: dispatch.status as 'RECEIVED' | 'PARTIALLY_RECEIVED',
          destinationLocationId: command.destinationLocationId,
          transitStockVersion: currentTransit.stockVersion,
          destinationStockVersion: destination.stockVersion,
          replayed: true,
        };
        await options.onCommitted?.(tx, result);
        return result;
      }

      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "StockDocument" WHERE "id" = ${command.stockDocumentId} FOR UPDATE
      `;
      const dispatch = await tx.stockDocument.findUnique({ where: { id: command.stockDocumentId } });
      if (!dispatch || dispatch.type !== 'TRANSFER' || !dispatch.destinationLocationId) {
        throw new Error('transfer_not_found');
      }
      if (!['DISPATCHED', 'PARTIALLY_RECEIVED'].includes(dispatch.status)) {
        throw new Error('transfer_not_receivable');
      }
      if (dispatch.destinationLocationId !== command.destinationLocationId) {
        throw new Error('transfer_destination_mismatch');
      }
      if (dispatch.version !== command.expectedDocumentVersion) throw new Error('document_stale');

      const { transit } = await findTransitLocation(tx, command.destinationLocationId);
      await lockTransitLocation(tx, transit.id, command.expectedTransitVersion);
      const destination = await lockLocation(
        tx,
        actor,
        command.destinationLocationId,
        'receive',
        command.expectedDestinationVersion,
      );
      const outstanding = await outstandingTransferLots(tx, dispatch.id, transit.id);
      validateTransferReceiptEvidence(
        [...outstanding.entries()].map(([inventoryItemId, lots]) => ({
          inventoryItemId,
          quantity: lots.reduce((sum, lot) => sum + lot.quantity, 0),
        })),
        lines,
        command.discrepancies,
      );
      const allocationsByItem = new Map<string, ReturnType<typeof selectLotAllocations>['allocations']>();
      for (const line of lines) {
        await assertLocationItemPolicy(tx, line.inventoryItemId, destination.id);
        const allocation = selectLotAllocations(outstanding.get(line.inventoryItemId) ?? [], line.quantity);
        if (allocation.shortage > 0) throw new Error('transfer_receipt_exceeds_dispatch');
        allocationsByItem.set(line.inventoryItemId, allocation.allocations);
      }
      for (const discrepancy of command.discrepancies) {
        await assertLocationItemPolicy(tx, discrepancy.inventoryItemId, destination.id);
      }

      const documentNumber = await generateStockDocumentNumber(tx, 'TRANSFER', command.occurredAt);
      const receipt = await tx.stockDocument.create({
        data: {
          documentNumber,
          type: 'TRANSFER',
          status: 'RECEIVED',
          parentDocumentId: dispatch.id,
          sourceLocationId: transit.id,
          destinationLocationId: destination.id,
          occurredAt: command.occurredAt,
          confirmedAt: command.occurredAt,
          notes: command.notes,
          idempotencyKey: command.idempotencyKey,
          inputHash,
          createdById: actor.id,
          confirmedById: actor.id,
        },
      });
      let movementIndex = 0;
      for (const line of lines) {
        for (const allocation of allocationsByItem.get(line.inventoryItemId) ?? []) {
          movementIndex += 1;
          const shared = {
            inventoryItemId: line.inventoryItemId,
            occurredAt: command.occurredAt,
            stockDocumentId: receipt.id,
            costLayerId: allocation.costLayerId,
            reference: dispatch.documentNumber,
          };
          await tx.stockMovement.createMany({
            data: [
              {
                ...shared,
                reason: 'TRANSFER_OUT',
                quantity: (-allocation.quantity).toFixed(3),
                branchId: transit.branchId,
                locationId: transit.id,
                externalId: `inventory-v2:${command.idempotencyKey}:transit-out:${movementIndex}`,
              },
              {
                ...shared,
                reason: 'TRANSFER_IN',
                quantity: allocation.quantity.toFixed(3),
                branchId: destination.branchId,
                locationId: destination.id,
                externalId: `inventory-v2:${command.idempotencyKey}:destination:${movementIndex}`,
              },
            ],
          });
        }
      }
      if (command.discrepancies.length) {
        await tx.stockDiscrepancy.createMany({
          data: command.discrepancies.map((row) => ({
            stockDocumentId: receipt.id,
            inventoryItemId: row.inventoryItemId,
            type: row.type,
            quantity: row.quantity.toFixed(3),
            notes: row.notes,
            reportedById: actor.id,
          })),
        });
      }
      const remaining = [...outstanding.entries()].reduce((total, [inventoryItemId, lots]) => {
        const received = lines.find((line) => line.inventoryItemId === inventoryItemId)?.quantity ?? 0;
        return total + Math.max(0, lots.reduce((sum, lot) => sum + lot.quantity, 0) - received);
      }, 0);
      await tx.stockDocument.update({
        where: { id: dispatch.id },
        data: {
          status: remaining <= 0 ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
          version: { increment: 1 },
        },
      });
      const [transitStockVersion, destinationStockVersion] = await Promise.all([
        bumpLocationVersion(tx, transit.id),
        bumpLocationVersion(tx, destination.id),
      ]);
      await auditStockCommand(tx, actor, 'RECEIVE_STOCK_TRANSFER', 'StockDocument', receipt.id, {
        dispatchDocumentId: dispatch.id,
        destinationLocationId: destination.id,
        lines: lines.map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: line.quantity.toFixed(3) })),
        discrepancyCount: command.discrepancies.length,
      });
      const result = {
        receiptDocumentId: receipt.id,
        documentNumber,
        dispatchStatus: remaining <= 0 ? 'RECEIVED' as const : 'PARTIALLY_RECEIVED' as const,
        destinationLocationId: destination.id,
        transitStockVersion,
        destinationStockVersion,
        replayed: false,
      };
      await options.onCommitted?.(tx, result);
      return result;
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'receive_transfer');
  }
}
