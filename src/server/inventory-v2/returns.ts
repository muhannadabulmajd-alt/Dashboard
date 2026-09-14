import 'server-only';
import type { Prisma, ReturnDisposition } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/session';
import { decimalNumber } from '@/lib/decimal';
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
  assertLocationItemPolicy,
  auditStockCommand,
  bumpLocationVersion,
  lockLocation,
} from './internal';
import { selectLotAllocations, type AvailableLot } from './lot-allocation';
import { generateStockDocumentNumber } from './numbering';
import { buildInventoryVarianceLinePlan, varianceAccountCode } from './inventory-variance';
import {
  DisposeReturnedGoodsCommandSchema,
  ReturnToQuarantineCommandSchema,
  type DisposeReturnedGoodsCommandInput,
  type ReturnToQuarantineCommandInput,
} from './schemas';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export type ReturnToQuarantineResult = {
  stockDocumentId: string;
  documentNumber: string;
  quarantineLocationId: string;
  stockVersion: number;
  replayed: boolean;
};

export type DisposeReturnedGoodsResult = {
  stockDocumentId: string;
  documentNumber: string;
  returnDocumentId: string;
  disposition: ReturnDisposition;
  totalCost: number;
  financeEntryId: string | null;
  quarantineStockVersion: number;
  destinationStockVersion: number | null;
  returnDocumentVersion: number;
  replayed: boolean;
};

type CommandOptions<TResult> = {
  beforeExecute?: CommandPreconditionHook;
  onCommitted?: CommandCommitHook<TResult>;
};

function inventoryVarianceCategory(category: string): 'GREEN_COFFEE' | 'PACKAGING' | 'OVERHEAD' {
  if (category === 'GREEN_COFFEE') return 'GREEN_COFFEE';
  if (category === 'PACKAGING') return 'PACKAGING';
  return 'OVERHEAD';
}

export type ReturnedLotBalance = AvailableLot & {
  inventoryItemId: string;
  lotNumber: string | null;
};

export function remainingReturnedLotQuantity(
  returnedQuantity: number,
  disposedQuantity: number,
): number {
  return Number(Math.max(0, returnedQuantity - disposedQuantity).toFixed(3));
}

export async function getReturnedLotBalances(
  tx: Db,
  returnDocumentId: string,
): Promise<{
  document: {
    id: string;
    documentNumber: string;
    version: number;
    sourceLocationId: string | null;
    destinationLocationId: string;
    branchId: string;
  };
  lots: ReturnedLotBalance[];
}> {
  const document = await tx.stockDocument.findUnique({
    where: { id: returnDocumentId },
    select: {
      id: true,
      documentNumber: true,
      type: true,
      version: true,
      sourceLocationId: true,
      destinationLocationId: true,
      destinationLocation: { select: { id: true, branchId: true, type: true } },
    },
  });
  if (
    !document
    || document.type !== 'RETURN'
    || !document.destinationLocationId
    || document.destinationLocation?.type !== 'QUARANTINE'
  ) {
    throw new Error('return_document_not_found');
  }
  const incoming = await tx.stockMovement.groupBy({
    by: ['inventoryItemId', 'costLayerId'],
    where: {
      stockDocumentId: returnDocumentId,
      locationId: document.destinationLocationId,
      costLayerId: { not: null },
      quantity: { gt: 0 },
    },
    _sum: { quantity: true },
  });
  const disposed = await tx.stockMovement.groupBy({
    by: ['inventoryItemId', 'costLayerId'],
    where: {
      locationId: document.destinationLocationId,
      costLayerId: { not: null },
      stockDocument: { parentDocumentId: returnDocumentId },
    },
    _sum: { quantity: true },
  });
  const disposedByLayer = new Map(
    disposed.map((row) => [
      `${row.inventoryItemId}:${row.costLayerId}`,
      Math.max(0, -decimalNumber(row._sum.quantity)),
    ]),
  );
  const layerIds = incoming.flatMap((row) => row.costLayerId ? [row.costLayerId] : []);
  const layers = await tx.inventoryCostLayer.findMany({
    where: { id: { in: layerIds } },
    select: {
      id: true,
      lotNumber: true,
      unitCost: true,
      receivedAt: true,
      bestBefore: true,
    },
  });
  const layerById = new Map(layers.map((row) => [row.id, row]));
  const lots = incoming.flatMap((row): ReturnedLotBalance[] => {
    if (!row.costLayerId) return [];
    const layer = layerById.get(row.costLayerId);
    if (!layer) return [];
    const returnedQuantity = decimalNumber(row._sum.quantity);
    const disposedQuantity = disposedByLayer.get(`${row.inventoryItemId}:${row.costLayerId}`) ?? 0;
    const quantity = remainingReturnedLotQuantity(returnedQuantity, disposedQuantity);
    return [{
      id: layer.id,
      inventoryItemId: row.inventoryItemId,
      lotNumber: layer.lotNumber,
      quantity,
      unitCost: decimalNumber(layer.unitCost),
      receivedAt: layer.receivedAt,
      bestBefore: layer.bestBefore,
    }];
  });
  return {
    document: {
      id: document.id,
      documentNumber: document.documentNumber,
      version: document.version,
      sourceLocationId: document.sourceLocationId,
      destinationLocationId: document.destinationLocationId,
      branchId: document.destinationLocation!.branchId,
    },
    lots,
  };
}

export async function returnFinishedGoodsToQuarantine(
  actor: CurrentUser,
  input: ReturnToQuarantineCommandInput,
  options: CommandOptions<ReturnToQuarantineResult> = {},
): Promise<ReturnToQuarantineResult> {
  requireInventoryV2Enabled();
  try {
    const command = ReturnToQuarantineCommandSchema.parse(input);
    const inputHash = inventoryCommandInputHash('RETURN_TO_QUARANTINE', actor.id, command);
    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      await options.beforeExecute?.(tx);
      const replay = await tx.stockDocument.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
        include: {
          movements: {
            where: { reason: 'QUARANTINE' },
            select: { orderLineId: true, quantity: true },
          },
        },
      });
      if (replay) {
        assertInventoryCommandReplay(replay.inputHash, inputHash);
        const returnedQuantity = replay.movements.reduce(
          (sum, movement) => sum + decimalNumber(movement.quantity),
          0,
        );
        if (
          replay.type !== 'RETURN'
          || replay.reason !== command.reason
          || replay.occurredAt.getTime() !== command.occurredAt.getTime()
          || replay.movements.some((movement) => movement.orderLineId !== command.orderLineId)
          || Math.abs(returnedQuantity - command.quantity) > 0.0005
          || !replay.destinationLocationId
        ) {
          throw new Error('idempotency_conflict');
        }
        const location = await tx.stockLocation.findUniqueOrThrow({
          where: { id: replay.destinationLocationId },
          select: { stockVersion: true },
        });
        const result: ReturnToQuarantineResult = {
          stockDocumentId: replay.id,
          documentNumber: replay.documentNumber,
          quarantineLocationId: replay.destinationLocationId,
          stockVersion: location.stockVersion,
          replayed: true,
        };
        await options.onCommitted?.(tx, result);
        return result;
      }
      const orderLine = await tx.orderLine.findUnique({
        where: { id: command.orderLineId },
        include: { order: { select: { id: true, orderNumber: true, fulfillmentLocationId: true } } },
      });
      if (!orderLine?.order.fulfillmentLocationId) throw new Error('order_fulfillment_location_missing');
      const fulfillmentLocationId = orderLine.order.fulfillmentLocationId;
      const fulfillment = await lockLocation(
        tx,
        actor,
        fulfillmentLocationId,
        'receive',
        command.expectedFulfillmentVersion,
      );
      const quarantine = await tx.stockLocation.findFirst({
        where: {
          branchId: fulfillment.branchId,
          type: 'QUARANTINE',
          isSystem: true,
          isActive: true,
        },
        select: { id: true, branchId: true, stockVersion: true },
      });
      if (!quarantine) throw new Error('quarantine_location_missing');
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "StockLocation" WHERE "id" = ${quarantine.id} FOR UPDATE
      `;
      const lockedQuarantine = await tx.stockLocation.findUniqueOrThrow({ where: { id: quarantine.id } });
      if (lockedQuarantine.stockVersion !== command.expectedQuarantineVersion) throw new Error('location_stale');

      const sold = await tx.stockMovement.groupBy({
        by: ['inventoryItemId', 'costLayerId'],
        where: { orderLineId: orderLine.id, reason: 'SOLD', costLayerId: { not: null } },
        _sum: { quantity: true },
      });
      const returned = await tx.stockMovement.groupBy({
        by: ['inventoryItemId', 'costLayerId'],
        where: { orderLineId: orderLine.id, reason: 'QUARANTINE', costLayerId: { not: null } },
        _sum: { quantity: true },
      });
      const returnedByLayer = new Map(
        returned.map((row) => [`${row.inventoryItemId}:${row.costLayerId}`, decimalNumber(row._sum.quantity)]),
      );
      const soldItemIds = [...new Set(sold.map((row) => row.inventoryItemId))];
      if (soldItemIds.length !== 1) throw new Error('return_inventory_link_ambiguous');
      const inventoryItemId = soldItemIds[0];
      const layerIds = sold.flatMap((row) => row.costLayerId ? [row.costLayerId] : []);
      const layers = await tx.inventoryCostLayer.findMany({
        where: { id: { in: layerIds } },
        select: { id: true, unitCost: true, receivedAt: true, bestBefore: true },
      });
      const layerById = new Map(layers.map((row) => [row.id, row]));
      const returnable: AvailableLot[] = sold.flatMap((row) => {
        if (!row.costLayerId) return [];
        const layer = layerById.get(row.costLayerId);
        if (!layer) return [];
        const quantity = Math.max(
          0,
          -decimalNumber(row._sum.quantity) - (returnedByLayer.get(`${row.inventoryItemId}:${row.costLayerId}`) ?? 0),
        );
        return [{
          id: layer.id,
          quantity,
          unitCost: decimalNumber(layer.unitCost),
          receivedAt: layer.receivedAt,
          bestBefore: layer.bestBefore,
        }];
      });
      const selected = selectLotAllocations(returnable, command.quantity);
      if (selected.shortage > 0) throw new Error('return_exceeds_sold_quantity');

      const documentNumber = await generateStockDocumentNumber(tx, 'RETURN', command.occurredAt);
      const document = await tx.stockDocument.create({
        data: {
          documentNumber,
          type: 'RETURN',
          status: 'RECEIVED',
          sourceLocationId: fulfillmentLocationId,
          destinationLocationId: quarantine.id,
          occurredAt: command.occurredAt,
          confirmedAt: command.occurredAt,
          reason: command.reason,
          idempotencyKey: command.idempotencyKey,
          inputHash,
          createdById: actor.id,
          confirmedById: actor.id,
        },
      });
      for (const [index, allocation] of selected.allocations.entries()) {
        await tx.stockMovement.create({
          data: {
            inventoryItemId,
            occurredAt: command.occurredAt,
            reason: 'QUARANTINE',
            quantity: allocation.quantity.toFixed(3),
            reference: orderLine.order.orderNumber,
            externalId: `inventory-v2:${command.idempotencyKey}:movement:${index + 1}`,
            branchId: quarantine.branchId,
            locationId: quarantine.id,
            stockDocumentId: document.id,
            costLayerId: allocation.costLayerId,
            orderId: orderLine.order.id,
            orderLineId: orderLine.id,
          },
        });
      }
      const stockVersion = await bumpLocationVersion(tx, quarantine.id);
      await auditStockCommand(tx, actor, 'RETURN_TO_QUARANTINE', 'StockDocument', document.id, {
        orderId: orderLine.order.id,
        orderLineId: orderLine.id,
        fulfillmentLocationId,
        quarantineLocationId: quarantine.id,
        quantity: command.quantity.toFixed(3),
        reason: command.reason,
      });
      const result: ReturnToQuarantineResult = {
        stockDocumentId: document.id,
        documentNumber,
        quarantineLocationId: quarantine.id,
        stockVersion,
        replayed: false,
      };
      await options.onCommitted?.(tx, result);
      return result;
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'return_to_quarantine');
  }
}

function dispositionMovementReason(disposition: ReturnDisposition) {
  if (disposition === 'WASTE') return 'WASTED' as const;
  if (disposition === 'RESTOCK') return 'RESTOCK' as const;
  if (disposition === 'REPACK') return 'REPACK' as const;
  return 'RETURN_TO_SUPPLIER' as const;
}

export async function disposeReturnedGoods(
  actor: CurrentUser,
  input: DisposeReturnedGoodsCommandInput,
  options: CommandOptions<DisposeReturnedGoodsResult> = {},
): Promise<DisposeReturnedGoodsResult> {
  requireInventoryV2Enabled();
  try {
    const command = DisposeReturnedGoodsCommandSchema.parse(input);
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
      throw new Error('return_disposition_forbidden');
    }
    const inputHash = inventoryCommandInputHash('DISPOSE_RETURNED_GOODS', actor.id, command);
    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      await options.beforeExecute?.(tx);
      const replay = await tx.stockDocument.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
        include: {
          movements: {
            select: {
              inventoryItemId: true,
              quantity: true,
              costLayer: { select: { unitCost: true } },
            },
          },
        },
      });
      if (replay) {
        assertInventoryCommandReplay(replay.inputHash, inputHash);
        const sourceMovements = replay.movements.filter((movement) => (
          movement.inventoryItemId === command.inventoryItemId
          && decimalNumber(movement.quantity) < 0
        ));
        const disposedQuantity = sourceMovements.reduce(
          (sum, movement) => sum + Math.abs(decimalNumber(movement.quantity)),
          0,
        );
        if (
          replay.parentDocumentId !== command.returnDocumentId
          || replay.returnDisposition !== command.disposition
          || replay.sourceLocationId === replay.destinationLocationId
          || replay.destinationLocationId !== (command.destinationLocationId ?? null)
          || replay.partyId !== (command.supplierPartyId ?? null)
          || replay.reason !== command.reason
          || replay.occurredAt.getTime() !== command.occurredAt.getTime()
          || Math.abs(disposedQuantity - command.quantity) > 0.0005
        ) {
          throw new Error('idempotency_conflict');
        }
        const financeEntry = replay.returnDisposition === 'WASTE'
          ? await tx.financeEntry.findUnique({
              where: { importKey: `RETURNWASTE:${replay.id}` },
              select: { id: true },
            })
          : null;
        if (!replay.sourceLocationId) throw new Error('idempotency_conflict');
        const [quarantine, destination, returnDocument] = await Promise.all([
          tx.stockLocation.findUniqueOrThrow({
            where: { id: replay.sourceLocationId },
            select: { stockVersion: true },
          }),
          replay.destinationLocationId
            ? tx.stockLocation.findUniqueOrThrow({
                where: { id: replay.destinationLocationId },
                select: { stockVersion: true },
              })
            : Promise.resolve(null),
          tx.stockDocument.findUniqueOrThrow({
            where: { id: command.returnDocumentId },
            select: { version: true },
          }),
        ]);
        const result: DisposeReturnedGoodsResult = {
          stockDocumentId: replay.id,
          documentNumber: replay.documentNumber,
          returnDocumentId: command.returnDocumentId,
          disposition: command.disposition,
          totalCost: sourceMovements.reduce(
            (sum, movement) => sum
              + Math.abs(decimalNumber(movement.quantity)) * decimalNumber(movement.costLayer?.unitCost),
            0,
          ),
          financeEntryId: financeEntry?.id ?? null,
          quarantineStockVersion: quarantine.stockVersion,
          destinationStockVersion: destination?.stockVersion ?? null,
          returnDocumentVersion: returnDocument.version,
          replayed: true,
        };
        await options.onCommitted?.(tx, result);
        return result;
      }
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "StockDocument" WHERE "id" = ${command.returnDocumentId} FOR UPDATE
      `;
      const state = await getReturnedLotBalances(tx, command.returnDocumentId);
      if (state.document.version !== command.expectedReturnDocumentVersion) {
        throw new Error('document_stale');
      }
      const itemLots = state.lots.filter((lot) => lot.inventoryItemId === command.inventoryItemId);
      const selected = selectLotAllocations(itemLots, command.quantity);
      if (selected.shortage > 0) throw new Error('return_disposition_exceeds_quarantine');
      const inventoryItem = await tx.inventoryItem.findUnique({
        where: { id: command.inventoryItemId },
        select: { id: true, nameEn: true, nameAr: true, category: true, unit: true, isActive: true },
      });
      if (!inventoryItem?.isActive) throw new Error('inventory_item_not_found');

      const quarantine = await lockLocation(
        tx,
        actor,
        state.document.destinationLocationId,
        'approve',
        command.expectedQuarantineVersion,
      );
      let destination: Awaited<ReturnType<typeof lockLocation>> | null = null;
      if (command.destinationLocationId && command.expectedDestinationVersion) {
        if (command.destinationLocationId === quarantine.id) throw new Error('return_destination_same_location');
        destination = await lockLocation(
          tx,
          actor,
          command.destinationLocationId,
          'approve',
          command.expectedDestinationVersion,
        );
        if (destination.branchId !== quarantine.branchId) throw new Error('return_destination_branch_mismatch');
        if (command.disposition === 'REPACK' && destination.type !== 'PACKING') {
          throw new Error('return_repack_location_required');
        }
        await assertLocationItemPolicy(
          tx,
          command.inventoryItemId,
          destination.id,
          command.disposition === 'RESTOCK' ? 'sell' : 'produce',
        );
      }
      if (command.supplierPartyId) {
        const supplier = await tx.party.findFirst({
          where: { id: command.supplierPartyId, type: 'SUPPLIER', isActive: true },
          select: { id: true },
        });
        if (!supplier) throw new Error('return_supplier_not_found');
      }

      const wastePlan = command.disposition === 'WASTE'
        ? buildInventoryVarianceLinePlan({
            difference: -command.quantity,
            allocations: selected.allocations,
          })
        : null;
      if (wastePlan && !state.document.sourceLocationId) {
        throw new Error('return_source_location_missing');
      }
      const variancePolicy = wastePlan
        ? await tx.inventoryVariancePolicy.findUnique({
            where: { locationId: state.document.sourceLocationId! },
          })
        : null;
      if (wastePlan && !variancePolicy?.isActive) throw new Error('variance_policy_required');
      const wasteAccountCode = wastePlan
        ? varianceAccountCode(variancePolicy, 'ROUTINE', 'LOSS')
        : null;
      if (wastePlan && (!wasteAccountCode || wastePlan.lineTotal <= 0)) {
        throw new Error(wasteAccountCode ? 'discrepancy_value_invalid' : 'variance_account_code_required');
      }

      const documentType = command.disposition === 'WASTE' ? 'WASTE' : 'ADJUSTMENT';
      const documentNumber = await generateStockDocumentNumber(tx, documentType, command.occurredAt);
      const document = await tx.stockDocument.create({
        data: {
          documentNumber,
          type: documentType,
          status: 'CONFIRMED',
          sourceLocationId: quarantine.id,
          destinationLocationId: destination?.id,
          occurredAt: command.occurredAt,
          confirmedAt: command.occurredAt,
          reason: command.reason,
          idempotencyKey: command.idempotencyKey,
          inputHash,
          parentDocumentId: command.returnDocumentId,
          returnDisposition: command.disposition,
          partyId: command.supplierPartyId,
          createdById: actor.id,
          confirmedById: actor.id,
        },
      });
      const financeEntry = wastePlan && wasteAccountCode
        ? await tx.financeEntry.create({
            data: {
              date: command.occurredAt,
              type: 'INVENTORY_LOSS',
              recordClass: 'EXPENSE',
              amount: wastePlan.lineTotal,
              currency: 'IQD',
              obligation: false,
              accountId: null,
              importKey: `RETURNWASTE:${document.id}`,
              description: `Returned goods waste: ${state.document.documentNumber}`,
              reference: state.document.documentNumber,
              branchId: quarantine.branchId,
              stockLocationId: quarantine.id,
              accountingCode: wasteAccountCode,
              isOpeningBalance: false,
              createdById: actor.id,
              ledgerLines: {
                create: {
                  lineNo: 1,
                  itemType: 'INVENTORY_LOSS',
                  itemName: inventoryItem.nameEn || inventoryItem.nameAr,
                  categoryType: inventoryVarianceCategory(inventoryItem.category),
                  inventoryItemId: command.inventoryItemId,
                  unit: inventoryItem.unit,
                  quantity: wastePlan.quantity.toFixed(3),
                  unitCost: wastePlan.averageUnitCost.toFixed(3),
                  landedUnitCost: wastePlan.averageUnitCost.toFixed(3),
                  lineTotal: wastePlan.lineTotal,
                  branchId: quarantine.branchId,
                  notes: command.reason,
                  spendTreatment: 'OPEX',
                  classificationStatus: 'CONFIRMED',
                  classificationSource: 'returned-goods-waste',
                },
              },
            },
            select: { id: true },
          })
        : null;
      const movementReason = dispositionMovementReason(command.disposition);
      let totalCost = 0;
      for (const [index, allocation] of selected.allocations.entries()) {
        totalCost += allocation.quantity * allocation.unitCost;
        await tx.stockMovement.create({
          data: {
            inventoryItemId: command.inventoryItemId,
            financeEntryId: financeEntry?.id,
            occurredAt: command.occurredAt,
            reason: movementReason,
            quantity: (-allocation.quantity).toFixed(3),
            reference: state.document.documentNumber,
            externalId: `inventory-v2:${command.idempotencyKey}:source:${index + 1}`,
            branchId: quarantine.branchId,
            locationId: quarantine.id,
            stockDocumentId: document.id,
            costLayerId: allocation.costLayerId,
          },
        });
        if (destination) {
          await tx.stockMovement.create({
            data: {
              inventoryItemId: command.inventoryItemId,
              occurredAt: command.occurredAt,
              reason: movementReason,
              quantity: allocation.quantity.toFixed(3),
              reference: state.document.documentNumber,
              externalId: `inventory-v2:${command.idempotencyKey}:destination:${index + 1}`,
              branchId: destination.branchId,
              locationId: destination.id,
              stockDocumentId: document.id,
              costLayerId: allocation.costLayerId,
            },
          });
        }
      }
      const quarantineStockVersion = await bumpLocationVersion(tx, quarantine.id);
      const destinationStockVersion = destination
        ? await bumpLocationVersion(tx, destination.id)
        : null;
      const returnDocument = await tx.stockDocument.update({
        where: { id: command.returnDocumentId },
        data: { version: { increment: 1 } },
        select: { version: true },
      });
      if (!destination) await syncActiveCost(command.inventoryItemId, tx);
      await auditStockCommand(tx, actor, 'DISPOSE_RETURNED_GOODS', 'StockDocument', document.id, {
        returnDocumentId: command.returnDocumentId,
        inventoryItemId: command.inventoryItemId,
        disposition: command.disposition,
        destinationLocationId: destination?.id ?? null,
        supplierPartyId: command.supplierPartyId ?? null,
        quantity: command.quantity.toFixed(3),
        totalCost: totalCost.toFixed(3),
        financeEntryId: financeEntry?.id ?? null,
        accountingCode: wasteAccountCode,
        accountingPolicyLocationId: wastePlan ? state.document.sourceLocationId : null,
        reason: command.reason,
      });
      const result: DisposeReturnedGoodsResult = {
        stockDocumentId: document.id,
        documentNumber,
        returnDocumentId: command.returnDocumentId,
        disposition: command.disposition,
        totalCost,
        financeEntryId: financeEntry?.id ?? null,
        quarantineStockVersion,
        destinationStockVersion,
        returnDocumentVersion: returnDocument.version,
        replayed: false,
      };
      await options.onCommitted?.(tx, result);
      return result;
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'dispose_returned_goods');
  }
}
