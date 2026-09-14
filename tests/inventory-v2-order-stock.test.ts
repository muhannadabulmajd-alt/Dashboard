import { describe, expect, it } from 'vitest';
import {
  orderLineSetsMatch,
  stockTargetForOrderStatusRole,
} from '@/server/inventory-v2/order-stock';

describe('Inventory V2 order stock lifecycle', () => {
  it('maps managed order roles to reservation states', () => {
    expect(stockTargetForOrderStatusRole('OPEN')).toBe('RESERVED');
    expect(stockTargetForOrderStatusRole('SALE')).toBe('CONSUMED');
    expect(stockTargetForOrderStatusRole('CANCELED')).toBe('NONE');
    expect(stockTargetForOrderStatusRole('RETURN')).toBe('NONE');
  });

  it('treats line ordering as irrelevant but detects material revisions', () => {
    const current = [
      { sku: 'A', quantity: 2, unitGrossPrice: 10_000, lineDiscount: 500 },
      { sku: 'B', quantity: 1, unitGrossPrice: 20_000, lineDiscount: 0 },
    ];
    expect(orderLineSetsMatch(current, [...current].reverse())).toBe(true);
    expect(orderLineSetsMatch(current, [
      { ...current[0], quantity: 3 },
      current[1],
    ])).toBe(false);
    expect(orderLineSetsMatch(current, [
      { ...current[0], lineDiscount: 0 },
      current[1],
    ])).toBe(false);
  });
});
