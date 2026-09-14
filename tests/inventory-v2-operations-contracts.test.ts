import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '@/server/auth/session';
import { stockLocationWhereForPermission } from '@/server/inventory-v2/access';
import {
  DispatchTransferCommandSchema,
  DisposeReturnedGoodsCommandSchema,
  PackFinishedGoodsCommandSchema,
  ReceiveStockCommandSchema,
  ReceiveTransferCommandSchema,
  RejectInventoryCountCommandSchema,
  ReviewReplenishmentRequestCommandSchema,
  ResolveStockDiscrepancyCommandSchema,
  RoastProductionCommandSchema,
  SubmitInventoryCountCommandSchema,
} from '@/server/inventory-v2/schemas';
import { replenishmentTransition } from '@/server/inventory-v2/replenishments';
import { InventoryVariancePolicySetupSchema } from '@/server/inventory-v2/setup';

const branchManager: CurrentUser = {
  id: 'user-branch',
  email: 'branch@example.test',
  name: 'Branch manager',
  role: 'BRANCH_MANAGER',
  branchId: 'branch-a',
  defaultStockLocationId: 'location-a',
};

const owner: CurrentUser = { ...branchManager, id: 'owner', role: 'OWNER' };
const commandBase = {
  idempotencyKey: 'inventory-v2:test:1234',
  occurredAt: new Date('2026-09-08T00:00:00.000Z'),
};

describe('Inventory V2 operational contracts', () => {
  it('builds permission-specific location predicates for scoped actors', () => {
    expect(stockLocationWhereForPermission(branchManager, 'view')).toEqual({
      userAccesses: { some: { userId: 'user-branch', canView: true } },
    });
    expect(stockLocationWhereForPermission(branchManager, 'dispatch')).toEqual({
      userAccesses: { some: { userId: 'user-branch', canView: true, canDispatch: true } },
    });
    expect(stockLocationWhereForPermission(owner, 'approve')).toEqual({});
  });

  it('enforces positive three-decimal transfer quantities and stock versions', () => {
    const valid = DispatchTransferCommandSchema.safeParse({
      ...commandBase,
      sourceLocationId: 'source',
      destinationLocationId: 'destination',
      lines: [{ inventoryItemId: 'item', quantity: 1.125 }],
      expectedSourceVersion: 1,
      expectedTransitVersion: 2,
    });
    expect(valid.success).toBe(true);
    expect(DispatchTransferCommandSchema.safeParse({
      ...commandBase,
      sourceLocationId: 'source',
      destinationLocationId: 'destination',
      lines: [{ inventoryItemId: 'item', quantity: 1.0004 }],
      expectedSourceVersion: 1,
      expectedTransitVersion: 2,
    }).success).toBe(false);
    expect(DispatchTransferCommandSchema.safeParse({
      ...commandBase,
      sourceLocationId: 'source',
      destinationLocationId: 'destination',
      lines: [{ inventoryItemId: 'item', quantity: 1 }],
      expectedSourceVersion: 0,
      expectedTransitVersion: 2,
    }).success).toBe(false);
  });

  it('requires complete discrepancy evidence and rejects duplicate count lines', () => {
    expect(ReceiveTransferCommandSchema.safeParse({
      ...commandBase,
      stockDocumentId: 'transfer',
      destinationLocationId: 'destination',
      lines: [{ inventoryItemId: 'item', quantity: 1 }],
      discrepancies: [{ inventoryItemId: 'item', type: 'SHORTAGE', quantity: 1, notes: '' }],
      expectedTransitVersion: 1,
      expectedDestinationVersion: 1,
      expectedDocumentVersion: 1,
    }).success).toBe(false);
    expect(ReceiveTransferCommandSchema.safeParse({
      ...commandBase,
      stockDocumentId: 'transfer',
      destinationLocationId: 'destination',
      lines: [],
      discrepancies: [{
        inventoryItemId: 'item',
        type: 'DAMAGE',
        quantity: 1,
        notes: 'Entire dispatched quantity arrived damaged',
      }],
      expectedTransitVersion: 1,
      expectedDestinationVersion: 1,
      expectedDocumentVersion: 1,
    }).success).toBe(true);
    expect(ReceiveTransferCommandSchema.safeParse({
      ...commandBase,
      stockDocumentId: 'transfer',
      destinationLocationId: 'destination',
      lines: [],
      discrepancies: [],
      expectedTransitVersion: 1,
      expectedDestinationVersion: 1,
      expectedDocumentVersion: 1,
    }).success).toBe(false);
    expect(SubmitInventoryCountCommandSchema.safeParse({
      locationId: 'location',
      countedAt: commandBase.occurredAt,
      reason: 'Opening physical count',
      lines: [
        { inventoryItemId: 'item', countedQuantity: 1 },
        { inventoryItemId: 'item', countedQuantity: 2 },
      ],
      idempotencyKey: commandBase.idempotencyKey,
      expectedLocationVersion: 1,
    }).success).toBe(false);
  });

  it('requires versioned, idempotent central discrepancy review input', () => {
    const base = {
      stockDiscrepancyId: 'discrepancy',
      decision: 'APPROVE' as const,
      resolution: 'Verified against signed receiving sheet',
      occurredAt: commandBase.occurredAt,
      idempotencyKey: commandBase.idempotencyKey,
      expectedDiscrepancyVersion: 1,
      expectedLocationVersion: 2,
    };
    expect(ResolveStockDiscrepancyCommandSchema.safeParse(base).success).toBe(true);
    expect(ResolveStockDiscrepancyCommandSchema.safeParse({
      ...base,
      decision: 'REJECT',
      approvedUnitCost: 1200,
    }).success).toBe(false);
    expect(ResolveStockDiscrepancyCommandSchema.safeParse({
      ...base,
      expectedDiscrepancyVersion: 0,
    }).success).toBe(false);
  });

  it('requires an explicit attestation for opening counts while routine counts remain partial', () => {
    const base = {
      locationId: 'location',
      countedAt: commandBase.occurredAt,
      reason: 'Signed opening physical count',
      lines: [{ inventoryItemId: 'item', countedQuantity: 0 }],
      idempotencyKey: commandBase.idempotencyKey,
      expectedLocationVersion: 1,
    };
    expect(SubmitInventoryCountCommandSchema.safeParse({
      ...base,
      kind: 'OPENING',
      openingAttestation: false,
    }).success).toBe(false);
    expect(SubmitInventoryCountCommandSchema.safeParse({
      ...base,
      kind: 'OPENING',
      openingAttestation: true,
    }).success).toBe(true);
    expect(SubmitInventoryCountCommandSchema.safeParse({ ...base, kind: 'ROUTINE' }).success).toBe(true);
    expect(RejectInventoryCountCommandSchema.safeParse({
      inventoryCountId: 'count',
      reason: 'Physical count must be repeated',
      idempotencyKey: commandBase.idempotencyKey,
      expectedCountVersion: 1,
    }).success).toBe(true);
  });

  it('requires complete safe ledger codes before enabling variance accounting', () => {
    const base = {
      locationId: 'location',
      expectedLocationVersion: 1,
      openingBalanceAccountCode: '1300.OPEN',
      inventoryGainAccountCode: '4900.GAIN',
      inventoryLossAccountCode: '5900.LOSS',
    };
    expect(InventoryVariancePolicySetupSchema.safeParse({ ...base, isActive: true }).success).toBe(true);
    expect(InventoryVariancePolicySetupSchema.safeParse({
      ...base,
      isActive: true,
      inventoryLossAccountCode: undefined,
    }).success).toBe(false);
    expect(InventoryVariancePolicySetupSchema.safeParse({
      ...base,
      isActive: true,
      inventoryGainAccountCode: 'not allowed!',
    }).success).toBe(false);
    expect(InventoryVariancePolicySetupSchema.safeParse({
      locationId: 'location',
      expectedLocationVersion: 1,
      isActive: false,
    }).success).toBe(true);
  });

  it('allows only central, versioned replenishment review decisions and valid transitions', () => {
    const base = {
      replenishmentRequestId: 'request',
      reason: 'Transfer is being prepared by central operations',
      idempotencyKey: commandBase.idempotencyKey,
      expectedRequestVersion: 1,
    };
    expect(ReviewReplenishmentRequestCommandSchema.safeParse({
      ...base,
      decision: 'START',
    }).success).toBe(true);
    expect(ReviewReplenishmentRequestCommandSchema.safeParse({
      ...base,
      decision: 'FULFILLED',
    }).success).toBe(false);
    expect(replenishmentTransition('OPEN', 'START')).toBe('IN_PROGRESS');
    expect(replenishmentTransition('OPEN', 'CANCEL')).toBe('CANCELLED');
    expect(replenishmentTransition('IN_PROGRESS', 'CANCEL')).toBe('CANCELLED');
    expect(() => replenishmentTransition('FULFILLED', 'CANCEL')).toThrow(
      'replenishment_transition_invalid',
    );
  });

  it('requires a real account for paid receipts while allowing supplier credit', () => {
    const base = {
      ...commandBase,
      inventoryItemId: 'item',
      locationId: 'location',
      quantity: 10,
      unitCost: 1250,
      expectedLocationVersion: 1,
    };
    expect(ReceiveStockCommandSchema.safeParse({ ...base, paymentMode: 'PAID', partyId: 'supplier' }).success).toBe(false);
    expect(ReceiveStockCommandSchema.safeParse({ ...base, paymentMode: 'PAID', accountId: 'cash', partyId: 'supplier' }).success).toBe(true);
    expect(ReceiveStockCommandSchema.safeParse({ ...base, paymentMode: 'CREDIT', partyId: 'supplier' }).success).toBe(true);
  });

  it('requires exactly one existing or new supplier for stock receipts', () => {
    const base = {
      ...commandBase,
      inventoryItemId: 'item',
      locationId: 'location',
      quantity: 10,
      unitCost: 1_250,
      paymentMode: 'CREDIT' as const,
      expectedLocationVersion: 1,
    };
    expect(ReceiveStockCommandSchema.safeParse({ ...base, partyId: 'supplier' }).success).toBe(true);
    expect(ReceiveStockCommandSchema.safeParse({
      ...base,
      newSupplier: {
        name: 'New Supplier',
        phone: '+9647700000000',
        address: 'Baghdad',
      },
    }).success).toBe(true);
    expect(ReceiveStockCommandSchema.safeParse(base).success).toBe(false);
    expect(ReceiveStockCommandSchema.safeParse({
      ...base,
      partyId: 'supplier',
      newSupplier: { name: 'Duplicate supplier source' },
    }).success).toBe(false);
  });

  it('validates accepted and rejected packing output independently', () => {
    const base = {
      locationId: 'packing',
      productId: 'product',
      outputInventoryItemId: 'finished',
      recipeVersionId: 'recipe',
      outputQuantity: 24,
      packedAt: commandBase.occurredAt,
      idempotencyKey: commandBase.idempotencyKey,
      expectedLocationVersion: 1,
    };
    expect(PackFinishedGoodsCommandSchema.safeParse({ ...base, rejectedQuantity: 0.125 }).success).toBe(true);
    expect(PackFinishedGoodsCommandSchema.safeParse({ ...base, rejectedQuantity: -1 }).success).toBe(false);
  });

  it('separates expected roast shrinkage from centrally reviewed abnormal loss', () => {
    const base = {
      ...commandBase,
      batchNumber: 'ROAST-2026-001',
      locationId: 'roastery',
      greenInventoryItemId: 'green',
      roastedInventoryItemId: 'roasted',
      origin: 'Colombia',
      greenInputGrams: 10_000,
      roastedOutputGrams: 8_500,
      expectedLocationVersion: 1,
      roastDate: commandBase.occurredAt,
    };
    expect(RoastProductionCommandSchema.safeParse({ ...base, abnormalLossGrams: 250 }).success).toBe(true);
    expect(RoastProductionCommandSchema.safeParse({
      ...base,
      roastedOutputGrams: 10_001,
    }).success).toBe(false);
    expect(RoastProductionCommandSchema.safeParse({
      ...base,
      abnormalLossGrams: 1_501,
    }).success).toBe(false);
  });

  it('requires explicit, disposition-specific return destinations and suppliers', () => {
    const base = {
      returnDocumentId: 'return-document',
      inventoryItemId: 'finished-item',
      quantity: 1,
      occurredAt: commandBase.occurredAt,
      reason: 'Inspected by central operations',
      idempotencyKey: commandBase.idempotencyKey,
      expectedQuarantineVersion: 1,
      expectedReturnDocumentVersion: 1,
    };
    expect(DisposeReturnedGoodsCommandSchema.safeParse({
      ...base,
      disposition: 'RESTOCK',
    }).success).toBe(false);
    expect(DisposeReturnedGoodsCommandSchema.safeParse({
      ...base,
      disposition: 'RESTOCK',
      destinationLocationId: 'finished-warehouse',
      expectedDestinationVersion: 1,
    }).success).toBe(true);
    expect(DisposeReturnedGoodsCommandSchema.safeParse({
      ...base,
      disposition: 'RETURN_TO_SUPPLIER',
    }).success).toBe(false);
    expect(DisposeReturnedGoodsCommandSchema.safeParse({
      ...base,
      disposition: 'RETURN_TO_SUPPLIER',
      supplierPartyId: 'supplier',
    }).success).toBe(true);
    expect(DisposeReturnedGoodsCommandSchema.safeParse({
      ...base,
      disposition: 'WASTE',
      destinationLocationId: 'somewhere',
    }).success).toBe(false);
  });
});
