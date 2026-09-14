import { describe, expect, it } from 'vitest';
import {
  assertStockDocumentReversalShape,
  stockDocumentReversalBlockCode,
} from '@/server/inventory-v2/reversals';
import { ReverseStockDocumentCommandSchema } from '@/server/inventory-v2/schemas';

const reversible = {
  type: 'PURCHASE_RECEIPT' as const,
  status: 'RECEIVED' as const,
  parentType: null,
  activeChildCount: 0,
  discrepancyCount: 0,
  discrepancyResolutionCount: 0,
  hasInventoryCount: false,
};

describe('Inventory V2 stock document reversals', () => {
  it('allows an independent posted inventory document with no dependents', () => {
    expect(() => assertStockDocumentReversalShape(reversible)).not.toThrow();
    expect(() => assertStockDocumentReversalShape({
      ...reversible,
      type: 'TRANSFER',
      status: 'DISPATCHED',
    })).not.toThrow();
  });

  it('blocks sales, counts, opening balances, and reversal documents from generic reversal', () => {
    for (const type of ['SALE', 'COUNT', 'OPENING', 'REVERSAL'] as const) {
      expect(() => assertStockDocumentReversalShape({ ...reversible, type }))
        .toThrow('stock_document_not_reversible');
    }
  });

  it('blocks documents with downstream stock or discrepancy evidence', () => {
    expect(() => assertStockDocumentReversalShape({ ...reversible, activeChildCount: 1 }))
      .toThrow('stock_document_has_dependents');
    expect(() => assertStockDocumentReversalShape({ ...reversible, discrepancyCount: 1 }))
      .toThrow('stock_document_has_discrepancies');
    expect(() => assertStockDocumentReversalShape({ ...reversible, discrepancyResolutionCount: 1 }))
      .toThrow('stock_document_requires_domain_reversal');
    expect(() => assertStockDocumentReversalShape({
      ...reversible,
      type: 'ADJUSTMENT',
      parentType: 'COUNT',
    })).toThrow('stock_document_requires_domain_reversal');
    expect(stockDocumentReversalBlockCode({ ...reversible, activeChildCount: 1 }))
      .toBe('stock_document_has_dependents');
  });

  it('requires a version for every distinct touched location', () => {
    const command = {
      stockDocumentId: 'stock-document',
      confirmationDocumentNumber: 'STK-REV-0001',
      reason: 'Operator entered the wrong receipt quantity',
      occurredAt: new Date('2026-09-09T00:00:00.000Z'),
      idempotencyKey: 'stock-reversal:1234',
      expectedDocumentVersion: 1,
      expectedLocationVersions: [
        { locationId: 'warehouse', stockVersion: 2 },
        { locationId: 'transit', stockVersion: 4 },
      ],
    };
    expect(ReverseStockDocumentCommandSchema.safeParse(command).success).toBe(true);
    expect(ReverseStockDocumentCommandSchema.safeParse({
      ...command,
      expectedLocationVersions: [
        { locationId: 'warehouse', stockVersion: 2 },
        { locationId: 'warehouse', stockVersion: 3 },
      ],
    }).success).toBe(false);
    expect(ReverseStockDocumentCommandSchema.safeParse({
      ...command,
      expectedLocationVersions: [],
    }).success).toBe(false);
    expect(ReverseStockDocumentCommandSchema.safeParse({
      ...command,
      confirmationDocumentNumber: '',
    }).success).toBe(false);
  });
});
