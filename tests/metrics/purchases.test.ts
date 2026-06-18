import { describe, expect, it } from 'vitest';
import { allocationTotal, classifyPurchase } from '@/lib/metrics/purchases';

describe('purchase classification', () => {
  it('splits a mixed invoice without treating inventory as operating expense', () => {
    const allocation = classifyPurchase({
      amount: 475_000,
      categoryType: null,
      ledgerLines: [
        { itemType: 'INVENTORY', lineTotal: 100_000, categoryType: 'GREEN_COFFEE' },
        { itemType: 'ASSET', lineTotal: 300_000, categoryType: 'EQUIPMENT' },
        { itemType: 'SERVICE', lineTotal: 50_000, categoryType: 'MAINTENANCE' },
        { itemType: 'EXPENSE', lineTotal: 25_000, categoryType: 'SHIPPING' },
      ],
      hasFixedAsset: false,
      hasInventoryLayer: true,
    });
    expect(allocation).toEqual({ operatingExpense: 75_000, inventory: 100_000, fixedAsset: 300_000, unclassified: 0 });
    expect(allocationTotal(allocation)).toBe(475_000);
  });

  it('keeps fixed assets and inventory receipts off the P&L', () => {
    expect(classifyPurchase({ amount: 90_000, categoryType: 'EQUIPMENT', ledgerLines: [], hasFixedAsset: true, hasInventoryLayer: false }).fixedAsset).toBe(90_000);
    expect(classifyPurchase({ amount: 40_000, categoryType: 'PACKAGING', ledgerLines: [], hasFixedAsset: false, hasInventoryLayer: true }).inventory).toBe(40_000);
  });

  it('surfaces ambiguous asset-like purchases instead of guessing', () => {
    const allocation = classifyPurchase({ amount: 20_000, categoryType: 'GREEN_COFFEE', ledgerLines: [], hasFixedAsset: false, hasInventoryLayer: false });
    expect(allocation.unclassified).toBe(20_000);
    expect(allocation.operatingExpense).toBe(0);
  });
});
