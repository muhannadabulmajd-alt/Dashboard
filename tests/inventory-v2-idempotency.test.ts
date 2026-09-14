import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => {
  const stockDocumentFindUnique = vi.fn();
  const packingBatchFindUnique = vi.fn();
  const stockReservationFindUnique = vi.fn();
  const stockReplenishmentFindUnique = vi.fn();
  const inventoryCountFindUnique = vi.fn();
  const stockDiscrepancyFindUnique = vi.fn();
  const localExpenseRequestFindUnique = vi.fn();
  const transaction = {
    $queryRaw: vi.fn(async () => []),
    stockDocument: { findUnique: stockDocumentFindUnique },
    packingBatch: { findUnique: packingBatchFindUnique },
    stockReservation: { findUnique: stockReservationFindUnique },
    stockReplenishmentRequest: { findUnique: stockReplenishmentFindUnique },
    inventoryCount: { findUnique: inventoryCountFindUnique },
    stockDiscrepancy: { findUnique: stockDiscrepancyFindUnique },
    localExpenseRequest: { findUnique: localExpenseRequestFindUnique },
  };
  return {
    stockDocumentFindUnique,
    packingBatchFindUnique,
    stockReservationFindUnique,
    stockReplenishmentFindUnique,
    inventoryCountFindUnique,
    stockDiscrepancyFindUnique,
    localExpenseRequestFindUnique,
    transaction,
    prisma: {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    },
  };
});

vi.mock('@/server/db/client', () => ({ prisma: database.prisma }));

import type { CurrentUser } from '@/server/auth/session';
import {
  assertInventoryCommandReplay,
  inventoryCommandInputHash,
} from '@/server/inventory-v2/idempotency';
import {
  approveInventoryCount,
  rejectInventoryCount,
  submitInventoryCount,
} from '@/server/inventory-v2/counts';
import { resolveStockDiscrepancy } from '@/server/inventory-v2/discrepancies';
import { recordLocalExpense, reviewLocalExpense } from '@/server/inventory-v2/local-expenses';
import { packFinishedGoods } from '@/server/inventory-v2/packing';
import { reviewReplenishmentRequest } from '@/server/inventory-v2/replenishments';
import {
  consumeFinishedStockReservation,
  releaseFinishedStockReservation,
  reserveFinishedStock,
} from '@/server/inventory-v2/reservations';
import { roastGreenCoffee } from '@/server/inventory-v2/roasting';

const actor: CurrentUser = {
  id: 'owner-1',
  email: 'owner@example.test',
  name: 'Owner',
  role: 'OWNER',
  branchId: null,
  defaultFinanceAccountId: 'account-1',
};
const occurredAt = new Date('2026-09-14T08:00:00.000Z');

describe('Inventory V2 idempotency conflicts', () => {
  let previousFlag: string | undefined;

  beforeAll(() => {
    previousFlag = process.env.INVENTORY_V2_ENABLED;
    process.env.INVENTORY_V2_ENABLED = 'true';
  });

  afterAll(() => {
    if (previousFlag === undefined) delete process.env.INVENTORY_V2_ENABLED;
    else process.env.INVENTORY_V2_ENABLED = previousFlag;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hashes commands canonically while binding the action, actor, dates, and bytes', () => {
    const left = inventoryCommandInputHash('RECEIVE', 'owner-1', {
      occurredAt,
      receipt: new Uint8Array([1, 2, 3]),
      nested: { quantity: 2, itemId: 'item-1' },
    });
    const reordered = inventoryCommandInputHash('RECEIVE', 'owner-1', {
      nested: { itemId: 'item-1', quantity: 2 },
      receipt: new Uint8Array([1, 2, 3]),
      occurredAt: new Date(occurredAt),
    });

    expect(reordered).toBe(left);
    expect(inventoryCommandInputHash('PACK', 'owner-1', { occurredAt })).not.toBe(left);
    expect(inventoryCommandInputHash('RECEIVE', 'owner-2', {
      occurredAt,
      receipt: new Uint8Array([1, 2, 3]),
      nested: { quantity: 2, itemId: 'item-1' },
    })).not.toBe(left);
    expect(inventoryCommandInputHash('RECEIVE', 'owner-1', {
      occurredAt,
      receipt: new Uint8Array([1, 2, 4]),
      nested: { quantity: 2, itemId: 'item-1' },
    })).not.toBe(left);
  });

  it('refuses missing or changed persisted command hashes', () => {
    expect(() => assertInventoryCommandReplay('same', 'same')).not.toThrow();
    expect(() => assertInventoryCommandReplay(null, 'same')).toThrow('idempotency_conflict');
    expect(() => assertInventoryCommandReplay('first', 'second')).toThrow('idempotency_conflict');
  });

  it('rejects a changed roast payload that reuses a committed execution key', async () => {
    const committedCommand = {
      batchNumber: 'ROAST-1',
      locationId: 'location-1',
      greenInventoryItemId: 'green-1',
      roastedInventoryItemId: 'roasted-1',
      origin: 'Brazil',
      roastLevel: 'MEDIUM',
      greenInputGrams: 1_100,
      roastedOutputGrams: 900,
      abnormalLossGrams: 0,
      roastDate: occurredAt,
      qcScore: 90,
      qcNotes: 'Passed QC',
      idempotencyKey: 'inventory-v2:roast:1',
      expectedLocationVersion: 1,
    };
    database.stockDocumentFindUnique.mockResolvedValue({
      id: 'document-1',
      documentNumber: 'LHB-STK-ROAST-1',
      type: 'ROAST',
      sourceLocationId: 'location-1',
      destinationLocationId: 'location-1',
      occurredAt,
      reason: 'ROAST-1',
      notes: 'Passed QC',
      inputHash: inventoryCommandInputHash('ROAST_GREEN_COFFEE', actor.id, committedCommand),
      roastBatch: {
        id: 'batch-1',
        batchNumber: 'ROAST-1',
        locationId: 'location-1',
        greenInventoryItemId: 'green-1',
        roastedInventoryItemId: 'roasted-1',
        origin: 'Brazil',
        roastLevel: 'MEDIUM',
        greenInputGrams: 1_100,
        roastedOutputGrams: 900,
        abnormalLossGrams: 0,
        roastDate: occurredAt,
        qcScore: 90,
        qcNotes: 'Passed QC',
      },
    });

    await expect(roastGreenCoffee(actor, {
      ...committedCommand,
      roastedOutputGrams: 899,
    })).rejects.toMatchObject({
      failure: { code: 'idempotency_conflict', stage: 'roast_green_coffee', retryable: false },
    });
    expect(database.packingBatchFindUnique).not.toHaveBeenCalled();
  });

  it('rejects a changed packing payload that reuses a committed execution key', async () => {
    const committedCommand = {
      locationId: 'location-1',
      productId: 'product-1',
      outputInventoryItemId: 'finished-1',
      recipeVersionId: 'recipe-1',
      outputQuantity: 4,
      rejectedQuantity: 0,
      packedAt: occurredAt,
      notes: 'Passed QC',
      idempotencyKey: 'inventory-v2:pack:1',
      expectedLocationVersion: 1,
    };
    database.packingBatchFindUnique.mockResolvedValue({
      id: 'packing-1',
      batchNumber: 'PACK-1',
      locationId: 'location-1',
      productId: 'product-1',
      outputInventoryItemId: 'finished-1',
      recipeVersionId: 'recipe-1',
      stockDocumentId: 'document-1',
      outputLotId: 'lot-1',
      outputQuantity: 4,
      rejectedQuantity: 0,
      packedAt: occurredAt,
      bestBefore: null,
      totalCost: 13_000,
      unitCost: 3_250,
      notes: 'Passed QC',
      stockDocument: {
        documentNumber: 'LHB-STK-PACK-1',
        type: 'PACK',
        sourceLocationId: 'location-1',
        destinationLocationId: 'location-1',
        occurredAt,
        inputHash: inventoryCommandInputHash('PACK_FINISHED_GOODS', actor.id, committedCommand),
      },
    });

    await expect(packFinishedGoods(actor, {
      ...committedCommand,
      outputQuantity: 3,
    })).rejects.toMatchObject({
      failure: { code: 'idempotency_conflict', stage: 'pack_finished_goods', retryable: false },
    });
    expect(database.stockDocumentFindUnique).not.toHaveBeenCalled();
  });

  it('rejects changed reservation create, consume, and release payloads', async () => {
    const reserveCommand = {
      inventoryItemId: 'finished-1',
      locationId: 'location-1',
      orderId: 'order-1',
      orderLineId: 'line-1',
      quantity: 2,
      idempotencyKey: 'inventory-v2:reserve:1',
      expectedLocationVersion: 1,
    };
    database.stockReservationFindUnique.mockResolvedValueOnce({
      id: 'reservation-1',
      inputHash: inventoryCommandInputHash('RESERVE_FINISHED_STOCK', actor.id, reserveCommand),
    });
    await expect(reserveFinishedStock(actor, { ...reserveCommand, quantity: 3 })).rejects.toMatchObject({
      failure: { code: 'idempotency_conflict', stage: 'reserve_stock' },
    });

    const consumeCommand = {
      reservationId: 'reservation-1',
      occurredAt,
      idempotencyKey: 'inventory-v2:consume:1',
      expectedLocationVersion: 1,
    };
    database.stockDocumentFindUnique.mockResolvedValueOnce({
      id: 'sale-1',
      documentNumber: 'LHB-STK-SALE-1',
      type: 'SALE',
      inputHash: inventoryCommandInputHash(
        'CONSUME_FINISHED_STOCK_RESERVATION',
        actor.id,
        consumeCommand,
      ),
    });
    await expect(consumeFinishedStockReservation(actor, {
      ...consumeCommand,
      occurredAt: new Date(occurredAt.getTime() + 1_000),
    })).rejects.toMatchObject({
      failure: { code: 'idempotency_conflict', stage: 'consume_reservation' },
    });

    const releaseCommand = {
      reservationId: 'reservation-1',
      reason: 'Order cancelled',
      idempotencyKey: 'inventory-v2:release:1',
      expectedLocationVersion: 1,
    };
    database.stockReservationFindUnique.mockResolvedValueOnce({
      id: 'reservation-1',
      status: 'RELEASED',
      releaseInputHash: inventoryCommandInputHash(
        'RELEASE_FINISHED_STOCK_RESERVATION',
        actor.id,
        releaseCommand,
      ),
    });
    await expect(releaseFinishedStockReservation(actor, {
      ...releaseCommand,
      reason: 'Different reason',
    })).rejects.toMatchObject({
      failure: { code: 'idempotency_conflict', stage: 'release_reservation' },
    });
  });

  it('rejects changed inventory count submission and review payloads', async () => {
    const submitCommand = {
      locationId: 'location-1',
      kind: 'ROUTINE' as const,
      countedAt: occurredAt,
      reason: 'Routine count',
      openingAttestation: false,
      lines: [{ inventoryItemId: 'finished-1', countedQuantity: 2 }],
      idempotencyKey: 'inventory-v2:count:1',
      expectedLocationVersion: 1,
    };
    const submitHash = inventoryCommandInputHash('SUBMIT_INVENTORY_COUNT', actor.id, submitCommand);
    database.inventoryCountFindUnique.mockResolvedValueOnce({
      id: 'count-1',
      countNumber: 'LHB-CNT-1',
      stockDocumentId: 'count-document-1',
      inputHash: submitHash,
      stockDocument: { inputHash: submitHash },
    });
    await expect(submitInventoryCount(actor, {
      ...submitCommand,
      reason: 'Changed routine count',
    })).rejects.toMatchObject({
      failure: { code: 'idempotency_conflict', stage: 'submit_count' },
    });

    const approveCommand = {
      inventoryCountId: 'count-1',
      reason: 'Approved count',
      occurredAt,
      idempotencyKey: 'inventory-v2:count-approve:1',
      expectedLocationVersion: 1,
      expectedCountVersion: 1,
    };
    const approveHash = inventoryCommandInputHash('APPROVE_INVENTORY_COUNT', actor.id, approveCommand);
    database.inventoryCountFindUnique.mockResolvedValueOnce({
      id: 'count-1',
      status: 'APPROVED',
      stockDocumentId: 'count-document-1',
      reviewInputHash: approveHash,
      financeEntries: [],
    });
    database.stockDocumentFindUnique.mockResolvedValueOnce({
      id: 'adjustment-1',
      documentNumber: 'LHB-STK-ADJ-1',
      type: 'ADJUSTMENT',
      parentDocumentId: 'count-document-1',
      inputHash: approveHash,
    });
    await expect(approveInventoryCount(actor, {
      ...approveCommand,
      reason: 'Changed approval',
    })).rejects.toMatchObject({
      failure: { code: 'idempotency_conflict', stage: 'approve_count' },
    });

    const rejectCommand = {
      inventoryCountId: 'count-2',
      reason: 'Rejected count',
      idempotencyKey: 'inventory-v2:count-reject:1',
      expectedCountVersion: 1,
    };
    database.inventoryCountFindUnique.mockResolvedValueOnce({
      id: 'count-2',
      countNumber: 'LHB-CNT-2',
      status: 'REJECTED',
      reviewInputHash: inventoryCommandInputHash('REJECT_INVENTORY_COUNT', actor.id, rejectCommand),
    });
    await expect(rejectInventoryCount(actor, {
      ...rejectCommand,
      reason: 'Changed rejection',
    })).rejects.toMatchObject({
      failure: { code: 'idempotency_conflict', stage: 'reject_count' },
    });
  });

  it('rejects changed discrepancy and replenishment review payloads', async () => {
    const discrepancyCommand = {
      stockDiscrepancyId: 'discrepancy-1',
      decision: 'REJECT' as const,
      resolution: 'Evidence rejected',
      occurredAt,
      idempotencyKey: 'inventory-v2:discrepancy:1',
      expectedDiscrepancyVersion: 1,
      expectedLocationVersion: 1,
    };
    database.stockDiscrepancyFindUnique.mockResolvedValueOnce({
      id: 'discrepancy-1',
      status: 'REJECTED',
      reviewInputHash: inventoryCommandInputHash(
        'RESOLVE_STOCK_DISCREPANCY',
        actor.id,
        discrepancyCommand,
      ),
      resolutionDocument: null,
      financeEntry: null,
    });
    await expect(resolveStockDiscrepancy(actor, {
      ...discrepancyCommand,
      resolution: 'Changed evidence',
    })).rejects.toMatchObject({
      failure: { code: 'idempotency_conflict', stage: 'resolve_discrepancy' },
    });

    const replenishmentCommand = {
      replenishmentRequestId: 'replenishment-1',
      decision: 'START' as const,
      reason: 'Dispatch approved',
      idempotencyKey: 'inventory-v2:replenishment:1',
      expectedRequestVersion: 1,
    };
    database.stockReplenishmentFindUnique.mockResolvedValueOnce({
      id: 'replenishment-1',
      requestNumber: 'LHB-RPL-1',
      status: 'IN_PROGRESS',
      reviewInputHash: inventoryCommandInputHash(
        'REVIEW_REPLENISHMENT_REQUEST',
        actor.id,
        replenishmentCommand,
      ),
    });
    await expect(reviewReplenishmentRequest(actor, {
      ...replenishmentCommand,
      reason: 'Changed approval',
    })).rejects.toMatchObject({
      failure: { code: 'idempotency_conflict', stage: 'review_replenishment' },
    });
  });

  it('rejects changed local expense submission and review payloads', async () => {
    const expenseCommand = {
      locationId: 'location-1',
      amount: 25_000,
      categoryType: 'SHIPPING' as const,
      description: 'Local delivery expense',
      occurredAt,
      noReceiptReason: 'Courier did not issue a receipt',
      idempotencyKey: 'inventory-v2:expense:1',
      expectedLocationVersion: 1,
    };
    database.localExpenseRequestFindUnique.mockResolvedValueOnce({
      id: 'expense-1',
      requestNumber: 'LHB-LEX-1',
      status: 'SUBMITTED',
      financeEntryId: null,
      submittedById: actor.id,
      inputHash: inventoryCommandInputHash('RECORD_LOCAL_EXPENSE', actor.id, expenseCommand),
    });
    await expect(recordLocalExpense(actor, {
      ...expenseCommand,
      description: 'Changed local delivery expense',
    })).rejects.toMatchObject({
      failure: { code: 'idempotency_conflict', stage: 'record_local_expense' },
    });

    const reviewCommand = {
      requestId: 'expense-1',
      decision: 'APPROVE' as const,
      reason: 'Receipt exception approved',
      occurredAt,
      idempotencyKey: 'inventory-v2:expense-review:1',
      expectedRequestVersion: 1,
      expectedLocationVersion: 1,
    };
    database.localExpenseRequestFindUnique.mockResolvedValueOnce({
      id: 'expense-1',
      requestNumber: 'LHB-LEX-1',
      status: 'POSTED',
      financeEntryId: 'finance-1',
      reviewInputHash: inventoryCommandInputHash('REVIEW_LOCAL_EXPENSE', actor.id, reviewCommand),
    });
    await expect(reviewLocalExpense(actor, {
      ...reviewCommand,
      reason: 'Changed approval reason',
    })).rejects.toMatchObject({
      failure: { code: 'idempotency_conflict', stage: 'review_local_expense' },
    });
  });
});
