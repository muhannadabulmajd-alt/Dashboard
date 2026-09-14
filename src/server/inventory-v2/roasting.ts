import 'server-only';

import type { CurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';
import { syncActiveCost } from '@/server/inventory/fifo';
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
import { generateStockDocumentNumber, stockLotNumber } from './numbering';
import {
  RoastProductionCommandSchema,
  type RoastProductionCommandInput,
} from './schemas';

function gramsInInventoryUnit(grams: number, unit: string): number {
  const normalized = unit.trim().toLowerCase();
  if (['kg', 'kilogram', 'kilo', 'كغ', 'كيلو', 'كجم'].includes(normalized)) {
    return Number((grams / 1_000).toFixed(3));
  }
  if (['g', 'gram', 'grams', 'غم', 'جم', 'غرام'].includes(normalized)) {
    return Number(grams.toFixed(3));
  }
  throw new Error('batch_inventory_unit');
}

export async function roastGreenCoffee(
  actor: CurrentUser,
  rawInput: RoastProductionCommandInput,
  options: {
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<RoastGreenCoffeeResult>;
  } = {},
) {
  requireInventoryV2Enabled();
  try {
    const command = RoastProductionCommandSchema.parse(rawInput);
    const inputHash = inventoryCommandInputHash('ROAST_GREEN_COFFEE', actor.id, command);
    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      await options.beforeExecute?.(tx);
      const replay = await tx.stockDocument.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
        include: { roastBatch: true },
      });
      if (replay) {
        assertInventoryCommandReplay(replay.inputHash, inputHash);
        const batch = replay.roastBatch;
        if (
          replay.type !== 'ROAST'
          || !batch
          || replay.sourceLocationId !== command.locationId
          || replay.destinationLocationId !== command.locationId
          || replay.occurredAt.getTime() !== command.roastDate.getTime()
          || replay.reason !== command.batchNumber
          || (replay.notes ?? null) !== (command.qcNotes ?? null)
          || batch.batchNumber !== command.batchNumber
          || batch.locationId !== command.locationId
          || batch.greenInventoryItemId !== command.greenInventoryItemId
          || batch.roastedInventoryItemId !== command.roastedInventoryItemId
          || batch.origin !== command.origin
          || (batch.roastLevel ?? null) !== (command.roastLevel ?? null)
          || batch.greenInputGrams !== command.greenInputGrams
          || batch.roastedOutputGrams !== command.roastedOutputGrams
          || batch.abnormalLossGrams !== command.abnormalLossGrams
          || (batch.roastDate?.getTime() ?? null) !== command.roastDate.getTime()
          || (batch.qcScore ?? null) !== (command.qcScore ?? null)
          || (batch.qcNotes ?? null) !== (command.qcNotes ?? null)
        ) {
          throw new Error('idempotency_conflict');
        }
        const result = {
          roastBatchId: batch.id,
          batchNumber: batch.batchNumber,
          stockDocumentId: replay.id,
          documentNumber: replay.documentNumber,
          replayed: true,
        };
        await options.onCommitted?.(tx, result);
        return result;
      }
      if (await tx.roastBatch.findUnique({ where: { batchNumber: command.batchNumber }, select: { id: true } })) {
        throw new Error('batch_exists');
      }
      const location = await lockLocation(
        tx,
        actor,
        command.locationId,
        'produce',
        command.expectedLocationVersion,
      );
      const [{ item: green }, { item: roasted }] = await Promise.all([
        assertLocationItemPolicy(tx, command.greenInventoryItemId, command.locationId, 'produce'),
        assertLocationItemPolicy(tx, command.roastedInventoryItemId, command.locationId, 'produce'),
      ]);
      if (green.category !== 'GREEN_COFFEE') throw new Error('green_inventory');
      if (roasted.category !== 'ROASTED') throw new Error('roasted_inventory');
      const greenQuantity = gramsInInventoryUnit(command.greenInputGrams, green.unit);
      const roastedQuantity = gramsInInventoryUnit(command.roastedOutputGrams, roasted.unit);
      const allocations = await allocateLocationLots(tx, green.id, command.locationId, greenQuantity);
      const exactInputCost = allocations.reduce(
        (total, allocation) => total + allocation.quantity * allocation.unitCost,
        0,
      );
      const abnormalCost = exactInputCost * (command.abnormalLossGrams / command.greenInputGrams);
      const outputCost = Math.max(0, exactInputCost - abnormalCost);
      const outputUnitCost = outputCost / roastedQuantity;
      const documentNumber = await generateStockDocumentNumber(tx, 'ROAST', command.roastDate);
      const document = await tx.stockDocument.create({
        data: {
          documentNumber,
          type: 'ROAST',
          status: 'CONFIRMED',
          sourceLocationId: location.id,
          destinationLocationId: location.id,
          occurredAt: command.roastDate,
          confirmedAt: command.roastDate,
          notes: command.qcNotes,
          reason: command.batchNumber,
          idempotencyKey: command.idempotencyKey,
          inputHash,
          createdById: actor.id,
          confirmedById: actor.id,
        },
      });
      const batch = await tx.roastBatch.create({
        data: {
          batchNumber: command.batchNumber,
          origin: command.origin,
          roastDate: command.roastDate,
          roastLevel: command.roastLevel,
          greenInputGrams: command.greenInputGrams,
          roastedOutputGrams: command.roastedOutputGrams,
          abnormalLossGrams: command.abnormalLossGrams,
          qcScore: command.qcScore,
          qcNotes: command.qcNotes,
          operatorId: actor.id,
          branchId: location.branchId,
          locationId: location.id,
          stockDocumentId: document.id,
          greenInventoryItemId: green.id,
          roastedInventoryItemId: roasted.id,
        },
      });
      for (const [index, allocation] of allocations.entries()) {
        await tx.stockMovement.create({
          data: {
            inventoryItemId: green.id,
            roastBatchId: batch.id,
            occurredAt: command.roastDate,
            reason: 'PRODUCTION_OUT',
            quantity: (-allocation.quantity).toFixed(3),
            reference: command.batchNumber,
            externalId: `inventory-v2:${command.idempotencyKey}:green:${index + 1}`,
            branchId: location.branchId,
            locationId: location.id,
            stockDocumentId: document.id,
            costLayerId: allocation.costLayerId,
          },
        });
      }
      const outputLayer = await tx.inventoryCostLayer.create({
        data: {
          inventoryItemId: roasted.id,
          roastBatchId: batch.id,
          stockDocumentId: document.id,
          lotNumber: stockLotNumber(documentNumber),
          roastDate: command.roastDate,
          qtyReceived: roastedQuantity.toFixed(3),
          unitCost: outputUnitCost.toFixed(3),
          receivedAt: command.roastDate,
        },
      });
      await tx.stockMovement.create({
        data: {
          inventoryItemId: roasted.id,
          roastBatchId: batch.id,
          occurredAt: command.roastDate,
          reason: 'PRODUCTION_IN',
          quantity: roastedQuantity.toFixed(3),
          reference: command.batchNumber,
          externalId: `inventory-v2:${command.idempotencyKey}:roasted`,
          branchId: location.branchId,
          locationId: location.id,
          stockDocumentId: document.id,
          costLayerId: outputLayer.id,
        },
      });
      if (command.abnormalLossGrams > 0) {
        const abnormalQuantity = gramsInInventoryUnit(command.abnormalLossGrams, green.unit);
        await tx.stockDiscrepancy.create({
          data: {
            stockDocumentId: document.id,
            inventoryItemId: green.id,
            type: 'DAMAGE',
            quantity: abnormalQuantity.toFixed(3),
            reportedUnitCost: (abnormalCost / abnormalQuantity).toFixed(3),
            stockEffectPending: false,
            notes: `Abnormal roast loss; estimated inventory value IQD ${abnormalCost.toFixed(3)}`,
            reportedById: actor.id,
          },
        });
      }
      const stockVersion = await bumpLocationVersion(tx, location.id);
      await syncActiveCost(green.id, tx);
      await syncActiveCost(roasted.id, tx);
      await auditStockCommand(tx, actor, 'ROAST_GREEN_COFFEE', 'RoastBatch', batch.id, {
        batchNumber: batch.batchNumber,
        locationId: location.id,
        greenInventoryItemId: green.id,
        roastedInventoryItemId: roasted.id,
        greenInputGrams: command.greenInputGrams,
        roastedOutputGrams: command.roastedOutputGrams,
        abnormalLossGrams: command.abnormalLossGrams,
        exactInputCost: exactInputCost.toFixed(3),
        abnormalLossCost: abnormalCost.toFixed(3),
        outputCost: outputCost.toFixed(3),
      });
      const result = {
        roastBatchId: batch.id,
        batchNumber: batch.batchNumber,
        stockDocumentId: document.id,
        documentNumber,
        outputLotId: outputLayer.id,
        stockVersion,
        inputCost: exactInputCost,
        abnormalLossCost: abnormalCost,
        outputCost,
        replayed: false,
      };
      await options.onCommitted?.(tx, result);
      return result;
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'roast_green_coffee');
  }
}

export type RoastGreenCoffeeResult = {
  roastBatchId: string;
  batchNumber: string;
  stockDocumentId: string;
  documentNumber: string;
  outputLotId?: string;
  stockVersion?: number;
  inputCost?: number;
  abnormalLossCost?: number;
  outputCost?: number;
  replayed: boolean;
};
