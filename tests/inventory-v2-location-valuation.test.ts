import { describe, expect, it } from 'vitest';
import { deriveLocationUnitCost } from '@/server/inventory-v2/location-valuation';

describe('Inventory V2 location valuation', () => {
  it('values the remaining exact lots at one location without using company-wide quantities', () => {
    expect(deriveLocationUnitCost([
      { quantity: 10, unitCost: 1_000 },
      { quantity: 5, unitCost: 1_500 },
      { quantity: -4, unitCost: 1_000 },
    ], 900)).toBeCloseTo(13_500 / 11);
  });

  it('uses the item fallback for legacy unlayered movement', () => {
    expect(deriveLocationUnitCost([
      { quantity: 3, unitCost: null },
      { quantity: -1, unitCost: null },
    ], 2_000)).toBe(2_000);
  });

  it('fails closed when an unlayered balance has no valuation source', () => {
    expect(deriveLocationUnitCost([{ quantity: 2, unitCost: null }], null)).toBeNull();
  });
});
