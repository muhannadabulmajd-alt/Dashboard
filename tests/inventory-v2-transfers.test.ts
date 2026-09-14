import { describe, expect, it } from 'vitest';
import {
  consolidateTransferLines,
  validateTransferReceiptEvidence,
} from '@/server/inventory-v2/transfers';
import { discrepancyResolutionContext } from '@/server/inventory-v2/discrepancies';

describe('Inventory V2 transfer commands', () => {
  it('consolidates duplicate item lines deterministically', () => {
    expect(consolidateTransferLines([
      { inventoryItemId: 'b', quantity: 1.125 },
      { inventoryItemId: 'a', quantity: 2 },
      { inventoryItemId: 'b', quantity: 0.875 },
    ])).toEqual([
      { inventoryItemId: 'a', quantity: 2 },
      { inventoryItemId: 'b', quantity: 2 },
    ]);
  });

  it('accepts partial receipt evidence without silently consuming an unresolved loss', () => {
    expect(() => validateTransferReceiptEvidence(
      [{ inventoryItemId: 'coffee', quantity: 10 }],
      [{ inventoryItemId: 'coffee', quantity: 7 }],
      [{ inventoryItemId: 'coffee', type: 'SHORTAGE', quantity: 2 }],
    )).not.toThrow();
  });

  it('rejects impossible receipt and discrepancy quantities', () => {
    expect(() => validateTransferReceiptEvidence(
      [{ inventoryItemId: 'coffee', quantity: 10 }],
      [{ inventoryItemId: 'coffee', quantity: 9 }],
      [{ inventoryItemId: 'coffee', type: 'DAMAGE', quantity: 2 }],
    )).toThrow('transfer_discrepancy_exceeds_outstanding');
    expect(() => validateTransferReceiptEvidence(
      [{ inventoryItemId: 'coffee', quantity: 10 }],
      [],
      [{ inventoryItemId: 'unknown', type: 'EXCESS', quantity: 1 }],
    )).toThrow('transfer_discrepancy_item_invalid');
  });

  it('routes transfer losses to transit and excess to the destination', () => {
    const stockDocument = {
      id: 'receipt',
      type: 'TRANSFER',
      parentDocumentId: 'dispatch',
      sourceLocation: { id: 'transit', branchId: 'branch-b' },
      destinationLocation: { id: 'sales-point', branchId: 'branch-b' },
    };
    expect(discrepancyResolutionContext({
      type: 'SHORTAGE',
      stockEffectPending: true,
      stockDocument,
    })).toMatchObject({
      direction: 'LOSS',
      locationId: 'transit',
      policyLocationId: 'sales-point',
      parentDocumentId: 'dispatch',
      movementReason: 'ADJUSTMENT',
    });
    expect(discrepancyResolutionContext({
      type: 'DAMAGE',
      stockEffectPending: true,
      stockDocument,
    })).toMatchObject({ direction: 'LOSS', locationId: 'transit', movementReason: 'WASTED' });
    expect(discrepancyResolutionContext({
      type: 'EXCESS',
      stockEffectPending: true,
      stockDocument,
    })).toMatchObject({
      direction: 'GAIN',
      locationId: 'sales-point',
      policyLocationId: 'sales-point',
      movementReason: 'ADJUSTMENT',
    });
  });

  it('treats abnormal roast loss as valuation-only stock evidence', () => {
    expect(discrepancyResolutionContext({
      type: 'DAMAGE',
      stockEffectPending: false,
      stockDocument: {
        id: 'roast-document',
        type: 'ROAST',
        parentDocumentId: null,
        sourceLocation: { id: 'roastery', branchId: 'central' },
        destinationLocation: { id: 'roastery', branchId: 'central' },
      },
    })).toMatchObject({
      direction: 'LOSS',
      locationId: 'roastery',
      policyLocationId: 'roastery',
      parentDocumentId: 'roast-document',
      transferDocumentId: null,
      movementReason: 'WASTED',
    });
  });
});
