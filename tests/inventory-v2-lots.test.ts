import { describe, expect, it } from 'vitest';
import { selectLotAllocations } from '@/server/inventory-v2/lot-allocation';
import {
  DispatchTransferCommandSchema,
  ReceiveStockCommandSchema,
} from '@/server/inventory-v2/schemas';

describe('Inventory V2 lot allocation and validation', () => {
  it('uses FEFO first and FIFO for lots without expiry', () => {
    const result = selectLotAllocations([
      { id: 'no-expiry-old', quantity: 10, unitCost: 3, receivedAt: new Date('2026-01-01'), bestBefore: null },
      { id: 'later-expiry', quantity: 4, unitCost: 5, receivedAt: new Date('2026-02-01'), bestBefore: new Date('2026-12-01') },
      { id: 'first-expiry', quantity: 3, unitCost: 4, receivedAt: new Date('2026-03-01'), bestBefore: new Date('2026-10-01') },
    ], 9);

    expect(result).toEqual({
      allocations: [
        { costLayerId: 'first-expiry', quantity: 3, unitCost: 4 },
        { costLayerId: 'later-expiry', quantity: 4, unitCost: 5 },
        { costLayerId: 'no-expiry-old', quantity: 2, unitCost: 3 },
      ],
      shortage: 0,
    });
  });

  it('reports shortages without fabricating stock', () => {
    expect(selectLotAllocations([
      { id: 'one', quantity: 1.25, unitCost: 10, receivedAt: new Date('2026-01-01'), bestBefore: null },
    ], 2)).toEqual({
      allocations: [{ costLayerId: 'one', quantity: 1.25, unitCost: 10 }],
      shortage: 0.75,
    });
  });

  it('requires an account for a paid receipt and three-decimal quantities', () => {
    const base = {
      inventoryItemId: 'item',
      locationId: 'location',
      quantity: 1.125,
      unitCost: 10,
      occurredAt: '2026-09-07',
      paymentMode: 'PAID',
      partyId: 'supplier',
      idempotencyKey: 'receipt-123',
      expectedLocationVersion: 1,
    };
    expect(ReceiveStockCommandSchema.safeParse(base).success).toBe(false);
    expect(ReceiveStockCommandSchema.safeParse({ ...base, accountId: 'cash' }).success).toBe(true);
    expect(ReceiveStockCommandSchema.safeParse({ ...base, accountId: 'cash', quantity: 1.1234 }).success).toBe(false);
  });

  it('rejects an empty transfer and duplicate-looking malformed inputs early', () => {
    expect(DispatchTransferCommandSchema.safeParse({
      sourceLocationId: 'source',
      destinationLocationId: 'destination',
      lines: [],
      occurredAt: new Date(),
      idempotencyKey: 'transfer-123',
      expectedSourceVersion: 1,
      expectedTransitVersion: 1,
    }).success).toBe(false);
  });
});
