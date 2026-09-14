import 'server-only';

import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/session';
import { decimalNumber } from '@/lib/decimal';
import { prisma } from '@/server/db/client';
import { syncActiveCost } from '@/server/inventory/fifo';
import { COMMAND_TRANSACTION_OPTIONS } from '@/server/commands/transaction-checkpoints';
import { requireInventoryV2Enabled } from './config';
import { inventoryCommandError } from './errors';
import {
  assertInventoryCommandReplay,
  inventoryCommandInputHash,
  lockInventoryCommandKey,
} from './idempotency';
import {
  auditStockCommand,
  bumpLocationVersion,
  lockLocation,
} from './internal';
import {
  buildInventoryVarianceLinePlan,
  varianceAccountCode,
  type InventoryVarianceDirection,
} from './inventory-variance';
import { selectLotAllocations } from './lot-allocation';
import { generateStockDocumentNumber, stockLotNumber } from './numbering';
import {
  ResolveStockDiscrepancyCommandSchema,
  type ResolveStockDiscrepancyCommandInput,
} from './schemas';
import { outstandingTransferLots } from './transfers';

type Tx = Prisma.TransactionClient;

function inventoryVarianceCategory(category: string): 'GREEN_COFFEE' | 'PACKAGING' | 'OVERHEAD' {
  if (category === 'GREEN_COFFEE') return 'GREEN_COFFEE';
  if (category === 'PACKAGING') return 'PACKAGING';
  return 'OVERHEAD';
}

type ResolutionContext = {
  direction: InventoryVarianceDirection;
  locationId: string;
  policyLocationId: string;
  branchId: string;
  parentDocumentId: string;
  transferDocumentId: string | null;
  movementReason: 'ADJUSTMENT' | 'WASTED';
};

export type DiscrepancyResolutionContextInput = {
  type: 'SHORTAGE' | 'DAMAGE' | 'EXCESS';
  stockEffectPending: boolean;
  stockDocument: {
    id: string;
    type: string;
    parentDocumentId: string | null;
    sourceLocation: { id: string; branchId: string } | null;
    destinationLocation: { id: string; branchId: string } | null;
  };
};

export function discrepancyResolutionContext(
  discrepancy: DiscrepancyResolutionContextInput,
): ResolutionContext {
  const document = discrepancy.stockDocument;
  if (document.type === 'TRANSFER' && document.parentDocumentId) {
    if (!discrepancy.stockEffectPending) throw new Error('discrepancy_stock_effect_invalid');
    const gain = discrepancy.type === 'EXCESS';
    const location = gain ? document.destinationLocation : document.sourceLocation;
    if (!location || !document.destinationLocation) throw new Error('discrepancy_location_missing');
    return {
      direction: gain ? 'GAIN' : 'LOSS',
      locationId: location.id,
      policyLocationId: document.destinationLocation.id,
      branchId: location.branchId,
      parentDocumentId: document.parentDocumentId,
      transferDocumentId: document.parentDocumentId,
      movementReason: discrepancy.type === 'DAMAGE' ? 'WASTED' : 'ADJUSTMENT',
    };
  }
  if (document.type === 'ROAST') {
    if (discrepancy.type === 'EXCESS' || discrepancy.stockEffectPending) {
      throw new Error('discrepancy_stock_effect_invalid');
    }
    const location = document.sourceLocation;
    if (!location) throw new Error('discrepancy_location_missing');
    return {
      direction: 'LOSS',
      locationId: location.id,
      policyLocationId: location.id,
      branchId: location.branchId,
      parentDocumentId: document.id,
      transferDocumentId: null,
      movementReason: 'WASTED',
    };
  }
  throw new Error('discrepancy_source_unsupported');
}

async function updateTransferStatus(tx: Tx, transferDocumentId: string, transitLocationId: string) {
  const outstanding = await outstandingTransferLots(tx, transferDocumentId, transitLocationId);
  const remaining = [...outstanding.values()].reduce(
    (total, lots) => total + lots.reduce((sum, lot) => sum + lot.quantity, 0),
    0,
  );
  await tx.stockDocument.update({
    where: { id: transferDocumentId },
    data: {
      status: remaining <= 0.0005 ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
      version: { increment: 1 },
    },
  });
  return remaining;
}

export async function resolveStockDiscrepancy(
  actor: CurrentUser,
  input: ResolveStockDiscrepancyCommandInput,
) {
  requireInventoryV2Enabled();
  try {
    const command = ResolveStockDiscrepancyCommandSchema.parse(input);
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
      throw new Error('discrepancy_resolution_forbidden');
    }
    const inputHash = inventoryCommandInputHash('RESOLVE_STOCK_DISCREPANCY', actor.id, command);

    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      const replay = await tx.stockDiscrepancy.findUnique({
        where: { reviewIdempotencyKey: command.idempotencyKey },
        include: { resolutionDocument: true, financeEntry: true },
      });
      if (replay) {
        assertInventoryCommandReplay(replay.reviewInputHash, inputHash);
        if (command.decision === 'APPROVE') {
          assertInventoryCommandReplay(replay.resolutionDocument?.inputHash, inputHash);
        }
        const expectedStatus = command.decision === 'APPROVE' ? 'RESOLVED' : 'REJECTED';
        if (replay.id !== command.stockDiscrepancyId || replay.status !== expectedStatus) {
          throw new Error('idempotency_conflict');
        }
        return {
          stockDiscrepancyId: replay.id,
          status: replay.status,
          resolutionDocumentId: replay.resolutionDocumentId,
          documentNumber: replay.resolutionDocument?.documentNumber ?? null,
          financeEntryId: replay.financeEntryId,
          replayed: true,
        };
      }

      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "StockDiscrepancy" WHERE "id" = ${command.stockDiscrepancyId} FOR UPDATE
      `;
      const discrepancy = await tx.stockDiscrepancy.findUnique({
        where: { id: command.stockDiscrepancyId },
        include: {
          inventoryItem: true,
          stockDocument: {
            include: {
              sourceLocation: true,
              destinationLocation: true,
            },
          },
          resolutionDocument: true,
          financeEntry: true,
        },
      });
      if (!discrepancy || discrepancy.status !== 'OPEN') {
        throw new Error('discrepancy_not_resolvable');
      }
      if (discrepancy.version !== command.expectedDiscrepancyVersion) {
        throw new Error('document_stale');
      }
      const context = discrepancyResolutionContext(discrepancy);
      const location = await lockLocation(
        tx,
        actor,
        context.locationId,
        'approve',
        command.expectedLocationVersion,
      );

      if (command.decision === 'REJECT') {
        const rejected = await tx.stockDiscrepancy.update({
          where: { id: discrepancy.id },
          data: {
            status: 'REJECTED',
            resolution: command.resolution,
            resolvedById: actor.id,
            resolvedAt: command.occurredAt,
            reviewIdempotencyKey: command.idempotencyKey,
            reviewInputHash: inputHash,
            version: { increment: 1 },
          },
        });
        await auditStockCommand(tx, actor, 'REJECT_STOCK_DISCREPANCY', 'StockDiscrepancy', discrepancy.id, {
          stockDocumentId: discrepancy.stockDocumentId,
          inventoryItemId: discrepancy.inventoryItemId,
          locationId: location.id,
          type: discrepancy.type,
          quantity: discrepancy.quantity.toString(),
          resolution: command.resolution,
        });
        return {
          stockDiscrepancyId: rejected.id,
          status: rejected.status,
          resolutionDocumentId: null,
          documentNumber: null,
          financeEntryId: null,
          replayed: false,
        };
      }

      const quantity = decimalNumber(discrepancy.quantity);
      let allocations: Array<{ costLayerId: string; quantity: number; unitCost: number }> = [];
      let positiveUnitCost: number | null = null;
      if (context.direction === 'GAIN') {
        if (!command.approvedUnitCost) throw new Error('discrepancy_unit_cost_required');
        positiveUnitCost = command.approvedUnitCost;
      } else if (command.approvedUnitCost !== undefined) {
        throw new Error('discrepancy_unit_cost_not_allowed');
      } else if (discrepancy.stockEffectPending) {
        if (!context.transferDocumentId) throw new Error('discrepancy_source_unsupported');
        const transferLots = await outstandingTransferLots(
          tx,
          context.transferDocumentId,
          context.locationId,
        );
        const selected = selectLotAllocations(
          transferLots.get(discrepancy.inventoryItemId) ?? [],
          quantity,
        );
        if (selected.shortage > 0) throw new Error('discrepancy_stock_stale');
        allocations = selected.allocations;
      } else {
        const reportedUnitCost = discrepancy.reportedUnitCost === null
          ? null
          : decimalNumber(discrepancy.reportedUnitCost);
        if (!reportedUnitCost || reportedUnitCost <= 0) {
          throw new Error('discrepancy_unit_cost_required');
        }
        allocations = [{
          costLayerId: 'valuation-only',
          quantity,
          unitCost: reportedUnitCost,
        }];
      }

      const plan = buildInventoryVarianceLinePlan({
        difference: context.direction === 'GAIN' ? quantity : -quantity,
        positiveUnitCost,
        allocations,
      });
      if (!plan || plan.lineTotal <= 0) throw new Error('discrepancy_value_invalid');
      const policy = await tx.inventoryVariancePolicy.findUnique({
        where: { locationId: context.policyLocationId },
      });
      if (!policy?.isActive) throw new Error('variance_policy_required');
      const accountCode = varianceAccountCode(policy, 'ROUTINE', context.direction);
      if (!accountCode) throw new Error('variance_account_code_required');

      const documentType = context.movementReason === 'WASTED' ? 'WASTE' : 'ADJUSTMENT';
      const documentNumber = await generateStockDocumentNumber(tx, documentType, command.occurredAt);
      const resolutionDocument = await tx.stockDocument.create({
        data: {
          documentNumber,
          type: documentType,
          status: 'CONFIRMED',
          sourceLocationId: context.direction === 'LOSS' ? context.locationId : null,
          destinationLocationId: context.direction === 'GAIN' ? context.locationId : null,
          parentDocumentId: context.parentDocumentId,
          occurredAt: command.occurredAt,
          confirmedAt: command.occurredAt,
          reason: command.resolution,
          idempotencyKey: command.idempotencyKey,
          inputHash,
          createdById: actor.id,
          confirmedById: actor.id,
        },
      });
      const financeType = context.direction === 'GAIN' ? 'INVENTORY_GAIN' : 'INVENTORY_LOSS';
      const financeEntry = await tx.financeEntry.create({
        data: {
          date: command.occurredAt,
          type: financeType,
          recordClass: context.direction === 'LOSS' ? 'EXPENSE' : null,
          amount: plan.lineTotal,
          currency: 'IQD',
          obligation: false,
          accountId: null,
          importKey: `INVDISC:${discrepancy.id}`,
          description: `Inventory discrepancy ${discrepancy.type.toLowerCase()}: ${discrepancy.stockDocument.documentNumber}`,
          reference: discrepancy.stockDocument.documentNumber,
          branchId: context.branchId,
          stockLocationId: context.locationId,
          accountingCode: accountCode,
          isOpeningBalance: false,
          createdById: actor.id,
          ledgerLines: {
            create: {
              lineNo: 1,
              itemType: financeType,
              itemName: discrepancy.inventoryItem.nameEn || discrepancy.inventoryItem.nameAr,
              categoryType: inventoryVarianceCategory(discrepancy.inventoryItem.category),
              inventoryItemId: discrepancy.inventoryItemId,
              unit: discrepancy.inventoryItem.unit,
              quantity: plan.quantity.toFixed(3),
              unitCost: plan.averageUnitCost.toFixed(3),
              landedUnitCost: plan.averageUnitCost.toFixed(3),
              lineTotal: plan.lineTotal,
              branchId: context.branchId,
              notes: command.resolution,
              spendTreatment: 'OPEX',
              classificationStatus: 'CONFIRMED',
              classificationSource: 'stock-discrepancy',
            },
          },
        },
        select: { id: true },
      });

      let stockVersion = location.stockVersion;
      if (discrepancy.stockEffectPending && context.direction === 'GAIN') {
        const layer = await tx.inventoryCostLayer.create({
          data: {
            inventoryItemId: discrepancy.inventoryItemId,
            financeEntryId: financeEntry.id,
            stockDocumentId: resolutionDocument.id,
            lotNumber: stockLotNumber(documentNumber),
            qtyReceived: plan.quantity.toFixed(3),
            unitCost: plan.averageUnitCost.toFixed(3),
            receivedAt: command.occurredAt,
          },
        });
        await tx.stockMovement.create({
          data: {
            inventoryItemId: discrepancy.inventoryItemId,
            financeEntryId: financeEntry.id,
            occurredAt: command.occurredAt,
            reason: context.movementReason,
            quantity: plan.quantity.toFixed(3),
            reference: discrepancy.stockDocument.documentNumber,
            externalId: `inventory-v2:${command.idempotencyKey}:movement:1`,
            branchId: context.branchId,
            locationId: context.locationId,
            stockDocumentId: resolutionDocument.id,
            costLayerId: layer.id,
          },
        });
        stockVersion = await bumpLocationVersion(tx, context.locationId);
        await syncActiveCost(discrepancy.inventoryItemId, tx);
      } else if (discrepancy.stockEffectPending) {
        for (const [index, allocation] of plan.allocations.entries()) {
          await tx.stockMovement.create({
            data: {
              inventoryItemId: discrepancy.inventoryItemId,
              financeEntryId: financeEntry.id,
              occurredAt: command.occurredAt,
              reason: context.movementReason,
              quantity: (-allocation.quantity).toFixed(3),
              reference: discrepancy.stockDocument.documentNumber,
              externalId: `inventory-v2:${command.idempotencyKey}:movement:${index + 1}`,
              branchId: context.branchId,
              locationId: context.locationId,
              stockDocumentId: resolutionDocument.id,
              costLayerId: allocation.costLayerId,
            },
          });
        }
        stockVersion = await bumpLocationVersion(tx, context.locationId);
        await syncActiveCost(discrepancy.inventoryItemId, tx);
      }

      const resolved = await tx.stockDiscrepancy.update({
        where: { id: discrepancy.id },
        data: {
          status: 'RESOLVED',
          resolution: command.resolution,
          resolvedById: actor.id,
          resolvedAt: command.occurredAt,
          resolutionDocumentId: resolutionDocument.id,
          financeEntryId: financeEntry.id,
          reviewIdempotencyKey: command.idempotencyKey,
          reviewInputHash: inputHash,
          version: { increment: 1 },
        },
      });
      const transferRemaining = context.transferDocumentId
        && discrepancy.stockEffectPending
        && context.direction === 'LOSS'
        ? await updateTransferStatus(tx, context.transferDocumentId, context.locationId)
        : null;
      await auditStockCommand(tx, actor, 'RESOLVE_STOCK_DISCREPANCY', 'StockDiscrepancy', discrepancy.id, {
        stockDocumentId: discrepancy.stockDocumentId,
        resolutionDocumentId: resolutionDocument.id,
        financeEntryId: financeEntry.id,
        inventoryItemId: discrepancy.inventoryItemId,
        locationId: context.locationId,
        policyLocationId: context.policyLocationId,
        type: discrepancy.type,
        direction: context.direction,
        quantity: plan.quantity.toFixed(3),
        exactValue: plan.exactValue.toFixed(3),
        lineTotal: plan.lineTotal,
        accountingCode: accountCode,
        stockEffectPosted: discrepancy.stockEffectPending,
        transferRemaining: transferRemaining?.toFixed(3) ?? null,
        resolution: command.resolution,
      });
      return {
        stockDiscrepancyId: resolved.id,
        status: resolved.status,
        resolutionDocumentId: resolutionDocument.id,
        documentNumber,
        financeEntryId: financeEntry.id,
        stockVersion,
        replayed: false,
      };
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'resolve_discrepancy');
  }
}
