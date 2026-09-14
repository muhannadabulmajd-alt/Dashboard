import 'server-only';
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
import { generateStockDocumentNumber, stockLotNumber } from './numbering';
import {
  PackFinishedGoodsCommandSchema,
  type PackFinishedGoodsCommandInput,
} from './schemas';

export async function packFinishedGoods(
  actor: CurrentUser,
  input: PackFinishedGoodsCommandInput,
  options: {
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<PackFinishedGoodsResult>;
  } = {},
): Promise<PackFinishedGoodsResult> {
  requireInventoryV2Enabled();
  try {
    const command = PackFinishedGoodsCommandSchema.parse(input);
    const inputHash = inventoryCommandInputHash('PACK_FINISHED_GOODS', actor.id, command);
    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      await options.beforeExecute?.(tx);
      const replay = await tx.packingBatch.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
        include: { stockDocument: true },
      });
      if (replay) {
        assertInventoryCommandReplay(replay.stockDocument.inputHash, inputHash);
        if (
          replay.locationId !== command.locationId
          || replay.productId !== command.productId
          || replay.outputInventoryItemId !== command.outputInventoryItemId
          || replay.recipeVersionId !== command.recipeVersionId
          || decimalNumber(replay.outputQuantity) !== command.outputQuantity
          || decimalNumber(replay.rejectedQuantity) !== command.rejectedQuantity
          || replay.packedAt.getTime() !== command.packedAt.getTime()
          || (replay.bestBefore?.getTime() ?? null) !== (command.bestBefore?.getTime() ?? null)
          || (replay.notes ?? null) !== (command.notes ?? null)
          || replay.stockDocument.type !== 'PACK'
          || replay.stockDocument.sourceLocationId !== command.locationId
          || replay.stockDocument.destinationLocationId !== command.locationId
          || replay.stockDocument.occurredAt.getTime() !== command.packedAt.getTime()
        ) {
          throw new Error('idempotency_conflict');
        }
        if (!replay.outputLotId) throw new Error('idempotency_result_incomplete');
        const result = {
          packingBatchId: replay.id,
          batchNumber: replay.batchNumber,
          stockDocumentId: replay.stockDocumentId,
          documentNumber: replay.stockDocument.documentNumber,
          outputLotId: replay.outputLotId,
          totalCost: decimalNumber(replay.totalCost),
          unitCost: decimalNumber(replay.unitCost),
          stockVersion: (await tx.stockLocation.findUniqueOrThrow({ where: { id: replay.locationId } })).stockVersion,
          replayed: true,
        };
        await options.onCommitted?.(tx, result);
        return result;
      }

      const location = await lockLocation(
        tx,
        actor,
        command.locationId,
        'produce',
        command.expectedLocationVersion,
      );
      const { item: outputItem, policy: outputPolicy } = await assertLocationItemPolicy(
        tx,
        command.outputInventoryItemId,
        command.locationId,
      );
      if (outputItem.productId !== command.productId) throw new Error('packing_output_product_mismatch');
      if (!outputPolicy.canSell) throw new Error('packing_output_not_sellable');
      if (!['FINISHED_GOOD', 'DRIP_BAGS', 'ACCESSORY'].includes(outputItem.category)) {
        throw new Error('packing_output_not_finished_good');
      }
      const recipe = await tx.productRecipeVersion.findUnique({
        where: { id: command.recipeVersionId },
        include: { components: true },
      });
      if (!recipe || !recipe.isActive || recipe.productId !== command.productId) {
        throw new Error('packing_recipe_stale');
      }

      const productionQuantity = command.outputQuantity + command.rejectedQuantity;
      const allocations = new Map<string, Awaited<ReturnType<typeof allocateLocationLots>>>();
      let manualCost = 0;
      for (const component of recipe.components) {
        const required = Number((decimalNumber(component.quantity) * productionQuantity).toFixed(3));
        if (required <= 0) continue;
        if (!component.inventoryItemId) {
          manualCost += required * decimalNumber(component.unitCost);
          continue;
        }
        await assertLocationItemPolicy(tx, component.inventoryItemId, command.locationId, 'produce');
        allocations.set(
          component.id,
          await allocateLocationLots(tx, component.inventoryItemId, command.locationId, required),
        );
      }

      const documentNumber = await generateStockDocumentNumber(tx, 'PACK', command.packedAt);
      const document = await tx.stockDocument.create({
        data: {
          documentNumber,
          type: 'PACK',
          status: 'CONFIRMED',
          sourceLocationId: command.locationId,
          destinationLocationId: command.locationId,
          occurredAt: command.packedAt,
          confirmedAt: command.packedAt,
          notes: command.notes,
          idempotencyKey: command.idempotencyKey,
          inputHash,
          createdById: actor.id,
          confirmedById: actor.id,
        },
      });
      let exactInputCost = 0;
      let movementIndex = 0;
      const componentRows: Array<{
        inventoryItemId: string;
        costLayerId: string;
        quantity: string;
        unitCost: string;
      }> = [];
      for (const component of recipe.components) {
        if (!component.inventoryItemId) continue;
        for (const allocation of allocations.get(component.id) ?? []) {
          movementIndex += 1;
          exactInputCost += allocation.quantity * allocation.unitCost;
          componentRows.push({
            inventoryItemId: component.inventoryItemId,
            costLayerId: allocation.costLayerId,
            quantity: allocation.quantity.toFixed(3),
            unitCost: allocation.unitCost.toFixed(3),
          });
          await tx.stockMovement.create({
            data: {
              inventoryItemId: component.inventoryItemId,
              occurredAt: command.packedAt,
              reason: 'PRODUCTION_OUT',
              quantity: (-allocation.quantity).toFixed(3),
              reference: documentNumber,
              externalId: `inventory-v2:${command.idempotencyKey}:input:${movementIndex}`,
              branchId: location.branchId,
              locationId: command.locationId,
              stockDocumentId: document.id,
              costLayerId: allocation.costLayerId,
            },
          });
        }
      }
      const totalCost = exactInputCost + manualCost;
      const unitCost = totalCost / command.outputQuantity;
      const outputLayer = await tx.inventoryCostLayer.create({
        data: {
          inventoryItemId: outputItem.id,
          stockDocumentId: document.id,
          lotNumber: stockLotNumber(documentNumber),
          packedAt: command.packedAt,
          bestBefore: command.bestBefore,
          qtyReceived: command.outputQuantity.toFixed(3),
          unitCost: unitCost.toFixed(3),
          receivedAt: command.packedAt,
        },
      });
      await tx.stockMovement.create({
        data: {
          inventoryItemId: outputItem.id,
          occurredAt: command.packedAt,
          reason: 'PRODUCTION_IN',
          quantity: command.outputQuantity.toFixed(3),
          reference: documentNumber,
          externalId: `inventory-v2:${command.idempotencyKey}:output`,
          expiryDate: command.bestBefore,
          branchId: location.branchId,
          locationId: command.locationId,
          stockDocumentId: document.id,
          costLayerId: outputLayer.id,
        },
      });
      const batch = await tx.packingBatch.create({
        data: {
          batchNumber: documentNumber.replace('-STK-', '-PCK-'),
          locationId: command.locationId,
          productId: command.productId,
          outputInventoryItemId: outputItem.id,
          recipeVersionId: recipe.id,
          stockDocumentId: document.id,
          outputLotId: outputLayer.id,
          outputQuantity: command.outputQuantity.toFixed(3),
          rejectedQuantity: command.rejectedQuantity.toFixed(3),
          packedAt: command.packedAt,
          bestBefore: command.bestBefore,
          totalCost: totalCost.toFixed(3),
          unitCost: unitCost.toFixed(3),
          notes: command.notes,
          operatorId: actor.id,
          idempotencyKey: command.idempotencyKey,
          components: { create: componentRows },
        },
      });
      const stockVersion = await bumpLocationVersion(tx, command.locationId);
      await auditStockCommand(tx, actor, 'PACK_FINISHED_GOODS', 'PackingBatch', batch.id, {
        batchNumber: batch.batchNumber,
        productId: command.productId,
        locationId: command.locationId,
        recipeVersionId: recipe.id,
        outputInventoryItemId: outputItem.id,
        outputQuantity: command.outputQuantity.toFixed(3),
        rejectedQuantity: command.rejectedQuantity.toFixed(3),
        totalCost: totalCost.toFixed(3),
        unitCost: unitCost.toFixed(3),
      });
      const result = {
        packingBatchId: batch.id,
        batchNumber: batch.batchNumber,
        stockDocumentId: document.id,
        documentNumber,
        outputLotId: outputLayer.id,
        totalCost,
        unitCost,
        stockVersion,
        replayed: false,
      };
      await options.onCommitted?.(tx, result);
      return result;
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'pack_finished_goods');
  }
}

export type PackFinishedGoodsResult = {
  packingBatchId: string;
  batchNumber: string;
  stockDocumentId: string;
  documentNumber: string;
  outputLotId: string;
  totalCost: number;
  unitCost: number;
  stockVersion: number;
  replayed: boolean;
};
