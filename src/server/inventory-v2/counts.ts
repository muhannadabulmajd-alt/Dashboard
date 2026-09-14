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
  hasValidPositiveAdjustmentCost,
  inventoryCountPostingType,
  OPENING_COUNT_ATTESTATION,
  openingCountCoverage,
} from './count-contracts';
import {
  buildInventoryVarianceLinePlan,
  inventoryVarianceLedgerClassification,
  varianceAccountCode,
  type InventoryVarianceDirection,
} from './inventory-variance';
import {
  ApproveInventoryCountCommandSchema,
  RejectInventoryCountCommandSchema,
  SubmitInventoryCountCommandSchema,
  type ApproveInventoryCountCommandInput,
  type RejectInventoryCountCommandInput,
  type SubmitInventoryCountCommandInput,
} from './schemas';

function inventoryVarianceCategory(category: string): 'GREEN_COFFEE' | 'PACKAGING' | 'OVERHEAD' {
  if (category === 'GREEN_COFFEE') return 'GREEN_COFFEE';
  if (category === 'PACKAGING') return 'PACKAGING';
  return 'OVERHEAD';
}

export async function submitInventoryCount(
  actor: CurrentUser,
  input: SubmitInventoryCountCommandInput,
  options: {
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<SubmitInventoryCountResult>;
  } = {},
) {
  requireInventoryV2Enabled();
  try {
    const command = SubmitInventoryCountCommandSchema.parse(input);
    const itemIds = command.lines.map((line) => line.inventoryItemId);
    if (new Set(itemIds).size !== itemIds.length) throw new Error('count_duplicate_item');
    const inputHash = inventoryCommandInputHash('SUBMIT_INVENTORY_COUNT', actor.id, command);

    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      await options.beforeExecute?.(tx);
      const replay = await tx.inventoryCount.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
        include: { stockDocument: true },
      });
      if (replay) {
        assertInventoryCommandReplay(replay.inputHash, inputHash);
        assertInventoryCommandReplay(replay.stockDocument?.inputHash, inputHash);
        const result = {
          inventoryCountId: replay.id,
          countNumber: replay.countNumber,
          stockDocumentId: replay.stockDocumentId,
          replayed: true,
        };
        await options.onCommitted?.(tx, result);
        return result;
      }
      const location = await lockLocation(
        tx,
        actor,
        command.locationId,
        'count',
        command.expectedLocationVersion,
      );
      if (command.kind === 'OPENING' && location.isSystem) {
        throw new Error('opening_count_system_location');
      }
      if (command.kind === 'OPENING') {
        const existingOpening = await tx.inventoryCount.findFirst({
          where: {
            locationId: command.locationId,
            kind: 'OPENING',
            status: { in: ['SUBMITTED', 'APPROVED'] },
          },
          select: { id: true },
        });
        if (existingOpening) throw new Error('opening_count_exists');
      }
      const activePolicies = await tx.inventoryLocationPolicy.findMany({
        where: { locationId: command.locationId, isActive: true },
        select: { inventoryItemId: true },
      });
      if (command.kind === 'OPENING') {
        const coverage = openingCountCoverage(
          activePolicies.map((policy) => policy.inventoryItemId),
          itemIds,
        );
        if (!coverage.complete) {
          throw new Error(
            `opening_count_incomplete:${coverage.missingItemIds.join(',')}:${coverage.unexpectedItemIds.join(',')}`,
          );
        }
      }
      const movementSums = await tx.stockMovement.groupBy({
        by: ['inventoryItemId'],
        where: { locationId: command.locationId, inventoryItemId: { in: itemIds } },
        _sum: { quantity: true },
      });
      const expectedByItem = new Map(
        movementSums.map((row) => [row.inventoryItemId, decimalNumber(row._sum.quantity)]),
      );
      for (const itemId of itemIds) {
        await assertLocationItemPolicy(tx, itemId, command.locationId);
      }
      const documentNumber = await generateStockDocumentNumber(tx, 'COUNT', command.countedAt);
      const document = await tx.stockDocument.create({
        data: {
          documentNumber,
          type: 'COUNT',
          status: 'SUBMITTED',
          sourceLocationId: command.locationId,
          destinationLocationId: command.locationId,
          occurredAt: command.countedAt,
          reason: command.reason,
          idempotencyKey: command.idempotencyKey,
          inputHash,
          createdById: actor.id,
        },
      });
      const count = await tx.inventoryCount.create({
        data: {
          countNumber: documentNumber.replace('-STK-', '-CNT-'),
          locationId: command.locationId,
          kind: command.kind,
          status: 'SUBMITTED',
          countedAt: command.countedAt,
          reason: command.reason,
          locationVersionSnapshot: location.stockVersion,
          openingAttestation: command.kind === 'OPENING' ? OPENING_COUNT_ATTESTATION : null,
          openingAttestedAt: command.kind === 'OPENING' ? new Date() : null,
          submittedById: actor.id,
          stockDocumentId: document.id,
          idempotencyKey: command.idempotencyKey,
          inputHash,
          lines: {
            create: command.lines.map((line) => {
              const expected = expectedByItem.get(line.inventoryItemId) ?? 0;
              return {
                inventoryItemId: line.inventoryItemId,
                expectedQuantity: expected.toFixed(3),
                countedQuantity: line.countedQuantity.toFixed(3),
                difference: (line.countedQuantity - expected).toFixed(3),
                notes: line.notes,
              };
            }),
          },
        },
      });
      await auditStockCommand(tx, actor, 'SUBMIT_INVENTORY_COUNT', 'InventoryCount', count.id, {
        countNumber: count.countNumber,
        kind: command.kind,
        locationId: command.locationId,
        lineCount: command.lines.length,
        openingAttested: command.kind === 'OPENING',
        reason: command.reason,
      });
      const result = {
        inventoryCountId: count.id,
        countNumber: count.countNumber,
        stockDocumentId: document.id,
        replayed: false,
      };
      await options.onCommitted?.(tx, result);
      return result;
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'submit_count');
  }
}

export type SubmitInventoryCountResult = {
  inventoryCountId: string;
  countNumber: string;
  stockDocumentId: string | null;
  replayed: boolean;
};

export async function approveInventoryCount(
  actor: CurrentUser,
  input: ApproveInventoryCountCommandInput,
) {
  requireInventoryV2Enabled();
  try {
    const command = ApproveInventoryCountCommandSchema.parse(input);
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') throw new Error('count_approval_forbidden');
    const inputHash = inventoryCommandInputHash('APPROVE_INVENTORY_COUNT', actor.id, command);
    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      const [replayCount, replayDocument] = await Promise.all([
        tx.inventoryCount.findUnique({
          where: { reviewIdempotencyKey: command.idempotencyKey },
          include: { financeEntries: { select: { id: true, type: true } } },
        }),
        tx.stockDocument.findUnique({
          where: { idempotencyKey: command.idempotencyKey },
        }),
      ]);
      if (replayCount || replayDocument) {
        assertInventoryCommandReplay(replayCount?.reviewInputHash, inputHash);
        assertInventoryCommandReplay(replayDocument?.inputHash, inputHash);
        if (
          !replayCount ||
          !replayDocument ||
          replayCount.id !== command.inventoryCountId ||
          replayCount.status !== 'APPROVED' ||
          replayDocument.parentDocumentId !== replayCount.stockDocumentId ||
          (replayDocument.type !== 'ADJUSTMENT' && replayDocument.type !== 'OPENING')
        ) {
          throw new Error('idempotency_conflict');
        }
        return {
          adjustmentDocumentId: replayDocument.id,
          stockDocumentId: replayDocument.id,
          documentNumber: replayDocument.documentNumber,
          documentType: replayDocument.type,
          inventoryCountId: replayCount.id,
          financeEntryIds: replayCount.financeEntries.map((entry) => entry.id),
          replayed: true,
        };
      }
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "InventoryCount" WHERE "id" = ${command.inventoryCountId} FOR UPDATE
      `;
      const count = await tx.inventoryCount.findUnique({
        where: { id: command.inventoryCountId },
        include: { lines: true, stockDocument: true },
      });
      if (!count?.stockDocument || count.status !== 'SUBMITTED') throw new Error('count_not_approvable');
      const countStockDocumentId = count.stockDocumentId!;
      if (count.version !== command.expectedCountVersion) throw new Error('document_stale');
      const location = await lockLocation(
        tx,
        actor,
        count.locationId,
        'approve',
        command.expectedLocationVersion,
      );
      if (location.stockVersion !== count.locationVersionSnapshot) {
        throw new Error('count_stock_stale');
      }
      if (count.kind === 'OPENING') {
        if (!count.openingAttestation || !count.openingAttestedAt || location.isSystem) {
          throw new Error('opening_count_not_attested');
        }
        const policies = await tx.inventoryLocationPolicy.findMany({
          where: { locationId: count.locationId, isActive: true },
          select: { inventoryItemId: true },
        });
        const coverage = openingCountCoverage(
          policies.map((policy) => policy.inventoryItemId),
          count.lines.map((line) => line.inventoryItemId),
        );
        if (!coverage.complete) throw new Error('opening_count_incomplete');
      }
      const nonZeroLines = count.lines.filter((line) => decimalNumber(line.difference) !== 0);
      const variancePolicy = nonZeroLines.length
        ? await tx.inventoryVariancePolicy.findUnique({ where: { locationId: count.locationId } })
        : null;
      if (nonZeroLines.length && !variancePolicy?.isActive) {
        throw new Error('variance_policy_required');
      }

      const variancePlans: Array<{
        line: (typeof count.lines)[number];
        item: Awaited<ReturnType<typeof assertLocationItemPolicy>>['item'];
        direction: InventoryVarianceDirection;
        quantity: number;
        exactValue: number;
        lineTotal: number;
        averageUnitCost: number;
        allocations: Array<{ costLayerId: string; quantity: number; unitCost: number }>;
        accountCode: string;
      }> = [];
      for (const line of nonZeroLines) {
        const difference = decimalNumber(line.difference);
        const { item } = await assertLocationItemPolicy(tx, line.inventoryItemId, count.locationId);
        const unitCost = item.unitCost === null ? null : decimalNumber(item.unitCost);
        if (!hasValidPositiveAdjustmentCost(difference, unitCost)) {
          throw new Error(
            count.kind === 'OPENING' ? 'opening_unit_cost_required' : 'adjustment_unit_cost_required',
          );
        }
        const allocations = difference < 0
          ? await allocateLocationLots(tx, line.inventoryItemId, count.locationId, -difference)
          : [];
        const plan = buildInventoryVarianceLinePlan({
          difference,
          positiveUnitCost: unitCost,
          allocations,
        });
        if (!plan) continue;
        const accountCode = varianceAccountCode(variancePolicy, count.kind, plan.direction);
        if (!accountCode) throw new Error('variance_account_code_required');
        variancePlans.push({ line, item, ...plan, accountCode });
      }

      const posting = inventoryCountPostingType(count.kind);
      const documentNumber = await generateStockDocumentNumber(
        tx,
        posting.documentType,
        command.occurredAt,
      );
      const adjustment = await tx.stockDocument.create({
        data: {
          documentNumber,
          type: posting.documentType,
          status: 'CONFIRMED',
          parentDocumentId: countStockDocumentId,
          sourceLocationId: count.locationId,
          destinationLocationId: count.locationId,
          occurredAt: command.occurredAt,
          confirmedAt: command.occurredAt,
          reason: command.reason,
          idempotencyKey: command.idempotencyKey,
          inputHash,
          createdById: actor.id,
          confirmedById: actor.id,
        },
      });
      const financeEntryIds = new Map<InventoryVarianceDirection, string>();
      for (const direction of ['GAIN', 'LOSS'] as const) {
        const lines = variancePlans.filter((line) => line.direction === direction);
        if (!lines.length) continue;
        const accountCodes = new Set(lines.map((line) => line.accountCode));
        if (accountCodes.size !== 1) throw new Error('variance_account_code_conflict');
        const financeType = direction === 'GAIN' ? 'INVENTORY_GAIN' : 'INVENTORY_LOSS';
        const amount = lines.reduce((sum, line) => sum + line.lineTotal, 0);
        const financeEntry = await tx.financeEntry.create({
          data: {
            date: command.occurredAt,
            type: financeType,
            recordClass: count.kind === 'ROUTINE' && direction === 'LOSS' ? 'EXPENSE' : null,
            amount,
            currency: 'IQD',
            obligation: false,
            accountId: null,
            importKey: `INVCOUNT:${count.id}:${direction}`,
            description: count.kind === 'OPENING'
              ? `Opening inventory balance: ${count.countNumber}`
              : `Inventory count ${direction.toLowerCase()}: ${count.countNumber}`,
            reference: count.countNumber,
            branchId: location.branchId,
            stockLocationId: count.locationId,
            inventoryCountId: count.id,
            accountingCode: [...accountCodes][0],
            isOpeningBalance: count.kind === 'OPENING',
            createdById: actor.id,
            ledgerLines: {
              create: lines.map((line, index) => ({
                lineNo: index + 1,
                ...inventoryVarianceLedgerClassification(count.kind === 'OPENING'),
                itemName: line.item.nameEn || line.item.nameAr,
                categoryType: inventoryVarianceCategory(line.item.category),
                inventoryItemId: line.item.id,
                unit: line.item.unit,
                quantity: line.quantity.toFixed(3),
                unitCost: line.averageUnitCost.toFixed(3),
                landedUnitCost: line.averageUnitCost.toFixed(3),
                lineTotal: line.lineTotal,
                branchId: location.branchId,
                notes: line.line.notes,
                classificationStatus: 'CONFIRMED',
                classificationSource: 'inventory-count',
              })),
            },
          },
          select: { id: true },
        });
        financeEntryIds.set(direction, financeEntry.id);
      }
      let movementIndex = 0;
      for (const plan of variancePlans) {
        const financeEntryId = financeEntryIds.get(plan.direction);
        if (!financeEntryId) throw new Error('inventory_finance_sync_failed');
        if (plan.direction === 'GAIN') {
          const layer = await tx.inventoryCostLayer.create({
            data: {
              inventoryItemId: plan.line.inventoryItemId,
              financeEntryId,
              stockDocumentId: adjustment.id,
              lotNumber: stockLotNumber(documentNumber, movementIndex + 1),
              qtyReceived: plan.quantity.toFixed(3),
              unitCost: plan.averageUnitCost.toFixed(3),
              receivedAt: command.occurredAt,
            },
          });
          movementIndex += 1;
          await tx.stockMovement.create({
            data: {
              inventoryItemId: plan.line.inventoryItemId,
              financeEntryId,
              occurredAt: command.occurredAt,
              reason: posting.movementReason,
              quantity: plan.quantity.toFixed(3),
              reference: count.countNumber,
              externalId: `inventory-v2:${command.idempotencyKey}:movement:${movementIndex}`,
              branchId: location.branchId,
              locationId: count.locationId,
              stockDocumentId: adjustment.id,
              costLayerId: layer.id,
            },
          });
        } else {
          for (const allocation of plan.allocations) {
            movementIndex += 1;
            await tx.stockMovement.create({
              data: {
                inventoryItemId: plan.line.inventoryItemId,
                financeEntryId,
                occurredAt: command.occurredAt,
                reason: posting.movementReason,
                quantity: (-allocation.quantity).toFixed(3),
                reference: count.countNumber,
                externalId: `inventory-v2:${command.idempotencyKey}:movement:${movementIndex}`,
                branchId: location.branchId,
                locationId: count.locationId,
                stockDocumentId: adjustment.id,
                costLayerId: allocation.costLayerId,
              },
            });
          }
        }
      }
      await tx.inventoryCount.update({
        where: { id: count.id },
        data: {
          status: 'APPROVED',
          approvedById: actor.id,
          approvedAt: command.occurredAt,
          reviewIdempotencyKey: command.idempotencyKey,
          reviewInputHash: inputHash,
          version: { increment: 1 },
        },
      });
      await tx.stockDocument.update({
        where: { id: countStockDocumentId },
        data: { status: 'CONFIRMED', confirmedById: actor.id, confirmedAt: command.occurredAt, version: { increment: 1 } },
      });
      const stockVersion = await bumpLocationVersion(tx, count.locationId);
      await auditStockCommand(tx, actor, 'APPROVE_INVENTORY_COUNT', 'InventoryCount', count.id, {
        countNumber: count.countNumber,
        kind: count.kind,
        adjustmentDocumentId: adjustment.id,
        reason: command.reason,
        financeEntries: [...financeEntryIds.entries()].map(([direction, id]) => ({ direction, id })),
        lines: variancePlans.map((line) => ({
          inventoryItemId: line.line.inventoryItemId,
          expectedQuantity: line.line.expectedQuantity.toString(),
          countedQuantity: line.line.countedQuantity.toString(),
          difference: line.line.difference.toString(),
          direction: line.direction,
          exactValue: line.exactValue.toFixed(3),
          lineTotal: line.lineTotal,
          accountingCode: line.accountCode,
        })),
      });
      return {
        adjustmentDocumentId: adjustment.id,
        stockDocumentId: adjustment.id,
        documentNumber,
        documentType: posting.documentType,
        inventoryCountId: count.id,
        financeEntryIds: [...financeEntryIds.values()],
        stockVersion,
        replayed: false,
      };
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'approve_count');
  }
}

export async function rejectInventoryCount(
  actor: CurrentUser,
  input: RejectInventoryCountCommandInput,
) {
  requireInventoryV2Enabled();
  try {
    const command = RejectInventoryCountCommandSchema.parse(input);
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') throw new Error('count_approval_forbidden');
    const inputHash = inventoryCommandInputHash('REJECT_INVENTORY_COUNT', actor.id, command);
    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      const replay = await tx.inventoryCount.findUnique({
        where: { reviewIdempotencyKey: command.idempotencyKey },
        select: { id: true, countNumber: true, status: true, reviewInputHash: true },
      });
      if (replay) {
        assertInventoryCommandReplay(replay.reviewInputHash, inputHash);
        if (replay.id !== command.inventoryCountId || replay.status !== 'REJECTED') {
          throw new Error('idempotency_conflict');
        }
        return { inventoryCountId: replay.id, countNumber: replay.countNumber, replayed: true };
      }
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "InventoryCount" WHERE "id" = ${command.inventoryCountId} FOR UPDATE
      `;
      const count = await tx.inventoryCount.findUnique({
        where: { id: command.inventoryCountId },
        include: { stockDocument: true },
      });
      if (!count?.stockDocument || count.status !== 'SUBMITTED') {
        throw new Error('count_not_approvable');
      }
      if (count.version !== command.expectedCountVersion) throw new Error('document_stale');
      const rejectedAt = new Date();
      await tx.inventoryCount.update({
        where: { id: count.id },
        data: {
          status: 'REJECTED',
          rejectedById: actor.id,
          rejectedAt,
          rejectionReason: command.reason,
          reviewIdempotencyKey: command.idempotencyKey,
          reviewInputHash: inputHash,
          version: { increment: 1 },
        },
      });
      await tx.stockDocument.update({
        where: { id: count.stockDocument.id },
        data: { status: 'REJECTED', reason: command.reason, version: { increment: 1 } },
      });
      await auditStockCommand(tx, actor, 'REJECT_INVENTORY_COUNT', 'InventoryCount', count.id, {
        countNumber: count.countNumber,
        kind: count.kind,
        locationId: count.locationId,
        reason: command.reason,
        rejectedAt: rejectedAt.toISOString(),
      });
      return { inventoryCountId: count.id, countNumber: count.countNumber, replayed: false };
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'reject_count');
  }
}
