import { describe, expect, it } from 'vitest';
import { selectLotAllocations } from '@/server/inventory-v2/lot-allocation';
import { remainingReturnedLotQuantity } from '@/server/inventory-v2/returns';
import {
  DisposeReturnedGoodsCommandSchema,
  ReturnToQuarantineCommandSchema,
} from '@/server/inventory-v2/schemas';

const commandBase = {
  occurredAt: new Date('2026-09-08T00:00:00.000Z'),
  idempotencyKey: 'return-command-123',
};

describe('Inventory V2 returned goods', () => {
  it('tracks only the undispositioned balance and never goes negative', () => {
    expect(remainingReturnedLotQuantity(3, 1.125)).toBe(1.875);
    expect(remainingReturnedLotQuantity(1, 1.0004)).toBe(0);
    expect(remainingReturnedLotQuantity(1, 2)).toBe(0);
  });

  it('allocates a partial disposition from exact returned lots in FEFO order', () => {
    expect(selectLotAllocations([
      { id: 'later', quantity: 2, unitCost: 1200, receivedAt: new Date('2026-01-01'), bestBefore: new Date('2026-12-01') },
      { id: 'earlier', quantity: 1, unitCost: 1100, receivedAt: new Date('2026-02-01'), bestBefore: new Date('2026-10-01') },
    ], 2.25)).toEqual({
      allocations: [
        { costLayerId: 'earlier', quantity: 1, unitCost: 1100 },
        { costLayerId: 'later', quantity: 1.25, unitCost: 1200 },
      ],
      shortage: 0,
    });
  });

  it('requires traceable order return quantities and a reason', () => {
    const base = {
      ...commandBase,
      orderLineId: 'order-line',
      quantity: 1.125,
      reason: 'Customer returned sealed product',
      expectedFulfillmentVersion: 1,
      expectedQuarantineVersion: 1,
    };
    expect(ReturnToQuarantineCommandSchema.safeParse(base).success).toBe(true);
    expect(ReturnToQuarantineCommandSchema.safeParse({ ...base, quantity: 1.1234 }).success).toBe(false);
    expect(ReturnToQuarantineCommandSchema.safeParse({ ...base, reason: '' }).success).toBe(false);
  });

  it('rejects supplier returns without a supplier and waste with a destination', () => {
    const base = {
      ...commandBase,
      returnDocumentId: 'return-document',
      inventoryItemId: 'item',
      quantity: 1,
      reason: 'Inspected by central operations',
      expectedQuarantineVersion: 1,
      expectedReturnDocumentVersion: 1,
    };
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
      destinationLocationId: 'warehouse',
    }).success).toBe(false);
  });
});
