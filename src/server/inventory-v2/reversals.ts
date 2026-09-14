import 'server-only';

import { Prisma, type StockDocumentStatus, type StockDocumentType } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/session';
import { decimalNumber } from '@/lib/decimal';
import { prisma } from '@/server/db/client';
import { syncActiveCost } from '@/server/inventory/fifo';
import { COMMAND_TRANSACTION_OPTIONS } from '@/server/commands/transaction-checkpoints';
import type {
  CommandCommitHook,
  CommandPreconditionHook,
} from '@/server/records/shared';
import { getLocationAvailability, getLotBalances } from './availability';
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
import { generateStockDocumentNumber } from './numbering';
import {
  ReverseStockDocumentCommandSchema,
  type ReverseStockDocumentCommandInput,
} from './schemas';
import { outstandingTransferLots } from './transfers';

type Tx = Prisma.TransactionClient;

export type ReverseStockDocumentResult = {
  stockDocumentId: string;
  reversalDocumentId: string;
  documentNumber: string;
  stockVersions: Array<{ locationId: string; stockVersion: number }>;
  financeReversalIds: string[];
  replayed: boolean;
};

const REVERSIBLE_TYPES = new Set<StockDocumentType>([
  'PURCHASE_RECEIPT',
  'ROAST',
  'PACK',
  'TRANSFER',
  'RETURN',
  'ADJUSTMENT',
  'WASTE',
]);

export type StockDocumentReversalShape = {
  type: StockDocumentType;
  status: StockDocumentStatus;
  parentType: StockDocumentType | null;
  activeChildCount: number;
  discrepancyCount: number;
  discrepancyResolutionCount: number;
  hasInventoryCount: boolean;
};

export function stockDocumentReversalBlockCode(
  shape: StockDocumentReversalShape,
): string | null {
  if (!REVERSIBLE_TYPES.has(shape.type) || shape.status === 'REVERSED') {
    return 'stock_document_not_reversible';
  }
  if (shape.parentType === 'COUNT' || shape.hasInventoryCount || shape.discrepancyResolutionCount > 0) {
    return 'stock_document_requires_domain_reversal';
  }
  if (shape.activeChildCount > 0) return 'stock_document_has_dependents';
  if (shape.discrepancyCount > 0) return 'stock_document_has_discrepancies';
  return null;
}

export function assertStockDocumentReversalShape(shape: StockDocumentReversalShape): void {
  const blockCode = stockDocumentReversalBlockCode(shape);
  if (blockCode) throw new Error(blockCode);
}

async function assertOutputStillReversible(
  tx: Tx,
  movements: Array<{
    inventoryItemId: string;
    locationId: string | null;
    costLayerId: string | null;
    quantity: Prisma.Decimal;
  }>,
) {
  const positive = new Map<string, {
    inventoryItemId: string;
    locationId: string;
    costLayerId: string;
    quantity: number;
  }>();
  for (const movement of movements) {
    const quantity = decimalNumber(movement.quantity);
    if (quantity <= 0) continue;
    if (!movement.locationId || !movement.costLayerId) throw new Error('stock_document_lot_missing');
    const key = `${movement.inventoryItemId}:${movement.locationId}:${movement.costLayerId}`;
    const current = positive.get(key);
    positive.set(key, {
      inventoryItemId: movement.inventoryItemId,
      locationId: movement.locationId,
      costLayerId: movement.costLayerId,
      quantity: Number(((current?.quantity ?? 0) + quantity).toFixed(3)),
    });
  }
  const byItemLocation = new Map<string, {
    inventoryItemId: string;
    locationId: string;
    quantity: number;
  }>();
  for (const row of positive.values()) {
    const lots = await getLotBalances(tx, row.inventoryItemId, row.locationId);
    const balance = lots.find((lot) => lot.id === row.costLayerId)?.quantity ?? 0;
    if (balance + 0.0005 < row.quantity) throw new Error('stock_document_output_consumed');
    const key = `${row.inventoryItemId}:${row.locationId}`;
    const current = byItemLocation.get(key);
    byItemLocation.set(key, {
      inventoryItemId: row.inventoryItemId,
      locationId: row.locationId,
      quantity: Number(((current?.quantity ?? 0) + row.quantity).toFixed(3)),
    });
  }
  for (const row of byItemLocation.values()) {
    const availability = await getLocationAvailability(tx, row.inventoryItemId, row.locationId);
    if (availability.available + 0.0005 < row.quantity) {
      throw new Error('stock_document_output_reserved_or_consumed');
    }
  }
}

async function reverseLinkedFinanceEntries(
  tx: Tx,
  actor: CurrentUser,
  financeEntryIds: string[],
  stockDocumentId: string,
  occurredAt: Date,
  reason: string,
) {
  if (!financeEntryIds.length) return new Map<string, string>();
  const orderedIds = [...financeEntryIds].sort();
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "FinanceEntry"
    WHERE "id" IN (${Prisma.join(orderedIds)})
    ORDER BY "id"
    FOR UPDATE
  `);
  const entries = await tx.financeEntry.findMany({
    where: { id: { in: orderedIds } },
    include: {
      settlements: {
        where: { archivedAt: null, reversedAt: null, reversalOfId: null },
        select: { id: true },
      },
      stockMovements: { select: { stockDocumentId: true } },
      costLayers: { select: { stockDocumentId: true } },
      fixedAssets: { select: { id: true } },
    },
  });
  if (entries.length !== financeEntryIds.length) throw new Error('stock_finance_entry_missing');
  const reversalIds = new Map<string, string>();
  for (const entry of entries) {
    if (
      entry.archivedAt
      || entry.reversedAt
      || entry.reversalOfId
      || entry.settlesId
      || entry.settlements.length
      || entry.providerSettlementId
      || entry.fixedAssets.length
      || entry.inventoryCountId
    ) {
      throw new Error('stock_finance_not_reversible');
    }
    if (
      entry.stockMovements.some((movement) => movement.stockDocumentId !== stockDocumentId)
      || entry.costLayers.some((layer) => layer.stockDocumentId !== stockDocumentId)
    ) {
      throw new Error('stock_finance_shared_dependency');
    }
    await tx.financeEntry.update({
      where: { id: entry.id },
      data: {
        reversedAt: occurredAt,
        reversedById: actor.id,
        reversalReason: reason,
      },
    });
    const reversal = await tx.financeEntry.create({
      data: {
        date: occurredAt,
        type: entry.type,
        recordClass: entry.recordClass,
        amount: entry.amount,
        currency: entry.currency,
        origCurrency: entry.origCurrency,
        origAmount: entry.origAmount,
        fxRate: entry.fxRate,
        obligation: entry.obligation,
        obligationKind: entry.obligationKind,
        dueDate: entry.dueDate,
        accountId: entry.accountId,
        toAccountId: entry.toAccountId,
        partyId: entry.partyId,
        categoryType: entry.categoryType,
        costRole: entry.costRole,
        paymentMethod: entry.paymentMethod,
        description: `Reversal marker for ${entry.reference ?? entry.id}: ${reason}`,
        reference: entry.reference,
        attachmentUrl: entry.attachmentUrl,
        branchId: entry.branchId,
        stockLocationId: entry.stockLocationId,
        accountingCode: entry.accountingCode,
        isOpeningBalance: entry.isOpeningBalance,
        orderId: entry.orderId,
        reversalOfId: entry.id,
        createdById: actor.id,
      },
      select: { id: true },
    });
    reversalIds.set(entry.id, reversal.id);
  }
  return reversalIds;
}

async function refreshParentDocument(
  tx: Tx,
  parentDocumentId: string,
  transitLocationId: string | null,
) {
  const parent = await tx.stockDocument.findUnique({
    where: { id: parentDocumentId },
    select: { id: true, type: true },
  });
  if (!parent) throw new Error('stock_document_parent_missing');
  if (parent.type !== 'TRANSFER') {
    await tx.stockDocument.update({
      where: { id: parent.id },
      data: { version: { increment: 1 } },
    });
    return;
  }
  if (!transitLocationId) throw new Error('transit_location_missing');
  const outstanding = await outstandingTransferLots(tx, parent.id, transitLocationId);
  const remaining = [...outstanding.values()].reduce(
    (total, lots) => total + lots.reduce((sum, lot) => sum + lot.quantity, 0),
    0,
  );
  const activeReceipts = await tx.stockDocument.count({
    where: {
      parentDocumentId: parent.id,
      type: 'TRANSFER',
      status: { not: 'REVERSED' },
    },
  });
  await tx.stockDocument.update({
    where: { id: parent.id },
    data: {
      status: remaining <= 0.0005
        ? 'RECEIVED'
        : activeReceipts > 0
          ? 'PARTIALLY_RECEIVED'
          : 'DISPATCHED',
      version: { increment: 1 },
    },
  });
}

export async function reverseStockDocument(
  actor: CurrentUser,
  input: ReverseStockDocumentCommandInput,
  options: {
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<ReverseStockDocumentResult>;
  } = {},
): Promise<ReverseStockDocumentResult> {
  requireInventoryV2Enabled();
  try {
    const command = ReverseStockDocumentCommandSchema.parse(input);
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
      throw new Error('stock_document_reversal_forbidden');
    }
    const inputHash = inventoryCommandInputHash('REVERSE_STOCK_DOCUMENT', actor.id, command);
    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      await options.beforeExecute?.(tx);
      const replay = await tx.stockDocument.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
      });
      if (replay) {
        assertInventoryCommandReplay(replay.inputHash, inputHash);
        const source = await tx.stockDocument.findUnique({
          where: { id: command.stockDocumentId },
          select: { documentNumber: true },
        });
        if (
          replay.type !== 'REVERSAL'
          || replay.reversalOfId !== command.stockDocumentId
          || replay.reason !== command.reason
          || replay.occurredAt.getTime() !== command.occurredAt.getTime()
          || source?.documentNumber !== command.confirmationDocumentNumber
        ) {
          throw new Error('idempotency_conflict');
        }
        const movements = await tx.stockMovement.findMany({
          where: { stockDocumentId: replay.id, locationId: { not: null } },
          select: { locationId: true },
        });
        const locationIds = [...new Set(movements.flatMap((movement) => (
          movement.locationId ? [movement.locationId] : []
        )))];
        const locations = await tx.stockLocation.findMany({
          where: { id: { in: locationIds } },
          select: { id: true, stockVersion: true },
        });
        const sourceFinance = await tx.financeEntry.findMany({
          where: {
            OR: [
              { stockMovements: { some: { stockDocumentId: command.stockDocumentId } } },
              { costLayers: { some: { stockDocumentId: command.stockDocumentId } } },
            ],
          },
          select: { id: true },
        });
        const financeReversalIds = sourceFinance.length
          ? await tx.financeEntry.findMany({
              where: { reversalOfId: { in: sourceFinance.map((entry) => entry.id) } },
              select: { id: true },
            })
          : [];
        const result: ReverseStockDocumentResult = {
          stockDocumentId: command.stockDocumentId,
          reversalDocumentId: replay.id,
          documentNumber: replay.documentNumber,
          stockVersions: locations.map((location) => ({
            locationId: location.id,
            stockVersion: location.stockVersion,
          })),
          financeReversalIds: financeReversalIds.map((entry) => entry.id),
          replayed: true,
        };
        await options.onCommitted?.(tx, result);
        return result;
      }

      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "StockDocument" WHERE "id" = ${command.stockDocumentId} FOR UPDATE
      `;
      const document = await tx.stockDocument.findUnique({
        where: { id: command.stockDocumentId },
        include: {
          parentDocument: { select: { id: true, type: true } },
          childDocuments: { select: { id: true, type: true, status: true } },
          movements: { orderBy: { createdAt: 'asc' } },
          costLayers: { select: { financeEntryId: true } },
          discrepancies: { select: { id: true } },
          discrepancyResolutions: { select: { id: true } },
          inventoryCount: { select: { id: true } },
          reversedByDocument: { select: { id: true } },
        },
      });
      if (!document) throw new Error('stock_document_not_found');
      if (command.confirmationDocumentNumber !== document.documentNumber) {
        throw new Error('stock_document_confirmation_mismatch');
      }
      if (document.version !== command.expectedDocumentVersion) throw new Error('document_stale');
      if (document.reversedByDocument) throw new Error('stock_document_already_reversed');
      assertStockDocumentReversalShape({
        type: document.type,
        status: document.status,
        parentType: document.parentDocument?.type ?? null,
        activeChildCount: document.childDocuments.filter(
          (child) => child.type !== 'REVERSAL' && child.status !== 'REVERSED',
        ).length,
        discrepancyCount: document.discrepancies.length,
        discrepancyResolutionCount: document.discrepancyResolutions.length,
        hasInventoryCount: Boolean(document.inventoryCount),
      });
      if (!document.movements.length) throw new Error('stock_document_has_no_movements');

      const locationIds = [...new Set(document.movements.flatMap((movement) => (
        movement.locationId ? [movement.locationId] : []
      )))].sort();
      const expectedByLocation = new Map(
        command.expectedLocationVersions.map((row) => [row.locationId, row.stockVersion]),
      );
      if (
        locationIds.length !== expectedByLocation.size
        || locationIds.some((locationId) => !expectedByLocation.has(locationId))
      ) {
        throw new Error('location_version_coverage_mismatch');
      }
      const lockedLocations = new Map<string, Awaited<ReturnType<typeof lockLocation>>>();
      for (const locationId of locationIds) {
        const expectedVersion = expectedByLocation.get(locationId);
        if (!expectedVersion) throw new Error('location_version_coverage_mismatch');
        lockedLocations.set(
          locationId,
          await lockLocation(tx, actor, locationId, 'approve', expectedVersion),
        );
      }
      await assertOutputStillReversible(tx, document.movements);

      const financeEntryIds = [...new Set([
        ...document.movements.flatMap((movement) => movement.financeEntryId ? [movement.financeEntryId] : []),
        ...document.costLayers.flatMap((layer) => layer.financeEntryId ? [layer.financeEntryId] : []),
      ])];
      const financeReversals = await reverseLinkedFinanceEntries(
        tx,
        actor,
        financeEntryIds,
        document.id,
        command.occurredAt,
        command.reason,
      );

      const documentNumber = await generateStockDocumentNumber(tx, 'REVERSAL', command.occurredAt);
      const reversalParentId = document.parentDocumentId
        ?? (document.type === 'RETURN' ? document.id : null);
      const reversal = await tx.stockDocument.create({
        data: {
          documentNumber,
          type: 'REVERSAL',
          status: 'CONFIRMED',
          sourceLocationId: document.destinationLocationId,
          destinationLocationId: document.sourceLocationId,
          parentDocumentId: reversalParentId,
          reversalOfId: document.id,
          occurredAt: command.occurredAt,
          confirmedAt: command.occurredAt,
          reason: command.reason,
          idempotencyKey: command.idempotencyKey,
          inputHash,
          createdById: actor.id,
          confirmedById: actor.id,
        },
      });
      const touchedItems = new Set<string>();
      for (const [index, movement] of document.movements.entries()) {
        if (!movement.locationId) throw new Error('stock_document_location_missing');
        touchedItems.add(movement.inventoryItemId);
        const reversalFinanceEntryId = movement.financeEntryId
          ? financeReversals.get(movement.financeEntryId)
          : null;
        if (movement.financeEntryId && !reversalFinanceEntryId) {
          throw new Error('stock_finance_reversal_missing');
        }
        await tx.stockMovement.create({
          data: {
            inventoryItemId: movement.inventoryItemId,
            financeEntryId: reversalFinanceEntryId,
            occurredAt: command.occurredAt,
            reason: 'REVERSAL',
            quantity: (-decimalNumber(movement.quantity)).toFixed(3),
            reference: document.documentNumber,
            externalId: `inventory-v2:${command.idempotencyKey}:movement:${index + 1}`,
            branchId: movement.branchId,
            locationId: movement.locationId,
            stockDocumentId: reversal.id,
            costLayerId: movement.costLayerId,
            orderId: movement.orderId,
            roastBatchId: movement.roastBatchId,
            orderLineId: movement.orderLineId,
          },
        });
      }
      await tx.stockDocument.update({
        where: { id: document.id },
        data: { status: 'REVERSED', version: { increment: 1 } },
      });
      if (document.parentDocumentId) {
        const transitLocationId = document.type === 'TRANSFER'
          ? document.sourceLocationId
          : null;
        await refreshParentDocument(tx, document.parentDocumentId, transitLocationId);
      }
      const stockVersions: Array<{ locationId: string; stockVersion: number }> = [];
      for (const locationId of locationIds) {
        stockVersions.push({
          locationId,
          stockVersion: await bumpLocationVersion(tx, locationId),
        });
      }
      for (const inventoryItemId of touchedItems) await syncActiveCost(inventoryItemId, tx);
      await auditStockCommand(tx, actor, 'REVERSE_STOCK_DOCUMENT', 'StockDocument', document.id, {
        reversalDocumentId: reversal.id,
        sourceDocumentNumber: document.documentNumber,
        reversalDocumentNumber: documentNumber,
        reason: command.reason,
        movementCount: document.movements.length,
        financeEntryIds,
        financeReversalIds: [...financeReversals.values()],
        stockVersions,
      });
      const result: ReverseStockDocumentResult = {
        stockDocumentId: document.id,
        reversalDocumentId: reversal.id,
        documentNumber,
        stockVersions,
        financeReversalIds: [...financeReversals.values()],
        replayed: false,
      };
      await options.onCommitted?.(tx, result);
      return result;
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'reverse_stock_document');
  }
}
