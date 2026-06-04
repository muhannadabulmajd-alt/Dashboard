import { describe, it, expect } from 'vitest';
import {
  currentStock,
  openingClosing,
  coverageDays,
  sellThroughRate,
  reorderAlerts,
  nearExpiry,
  stockValueByCategory,
} from '@/lib/metrics/inventory';
import { makeItem, makeMovement } from '../fixtures/builders';

describe('inventory metrics', () => {
  const movements = [
    makeMovement({ reason: 'OPENING', quantity: 10_000, occurredAt: new Date('2026-04-01') }),
    makeMovement({ reason: 'PURCHASE', quantity: 5_000, occurredAt: new Date('2026-05-10') }),
    makeMovement({ reason: 'SOLD', quantity: -3_000, occurredAt: new Date('2026-05-12') }),
    makeMovement({ reason: 'WASTED', quantity: -500, occurredAt: new Date('2026-05-13') }),
  ];

  it('currentStock is the signed sum', () => {
    expect(currentStock(movements)).toBe(11_500);
  });

  it('openingClosing splits additions and deductions within a window', () => {
    const oc = openingClosing(movements, new Date('2026-05-01'), new Date('2026-05-31'));
    expect(oc.opening).toBe(10_000); // before window
    expect(oc.additions).toBe(5_000);
    expect(oc.deductions).toBe(3_500);
    expect(oc.closing).toBe(11_500);
  });

  it('coverageDays returns null without usage', () => {
    expect(coverageDays(10_000, 1_000)).toBe(10);
    expect(coverageDays(10_000, null)).toBeNull();
    expect(coverageDays(10_000, 0)).toBeNull();
  });

  it('sellThroughRate guards zero produced', () => {
    expect(sellThroughRate(30, 120)).toBe(0.25);
    expect(sellThroughRate(30, 0)).toBe(0);
  });

  it('reorderAlerts flags items at/under reorder point', () => {
    const low = makeItem({
      reorderPoint: 2_000,
      movements: [makeMovement({ reason: 'OPENING', quantity: 1_500 })],
    });
    const ok = makeItem({
      reorderPoint: 2_000,
      movements: [makeMovement({ reason: 'OPENING', quantity: 9_000 })],
    });
    const alerts = reorderAlerts([low, ok]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].item.id).toBe(low.id);
  });

  it('nearExpiry surfaces in-stock lots expiring soon', () => {
    const now = new Date('2026-06-01');
    const item = makeItem({
      movements: [
        makeMovement({ quantity: 500, expiryDate: new Date('2026-06-10') }), // 9 days
        makeMovement({ quantity: 500, expiryDate: new Date('2026-09-01') }), // far
        makeMovement({ quantity: -100, expiryDate: new Date('2026-06-05') }), // deduction, ignored
      ],
    });
    const rows = nearExpiry([item], 30, now);
    expect(rows).toHaveLength(1);
    expect(rows[0].daysToExpiry).toBe(9);
  });

  it('stockValueByCategory multiplies stock by unit cost', () => {
    const green = makeItem({
      category: 'GREEN_COFFEE',
      unitCost: 2,
      movements: [makeMovement({ quantity: 1_000 })],
    });
    const roasted = makeItem({
      category: 'ROASTED',
      unitCost: 5,
      movements: [makeMovement({ quantity: 200 })],
    });
    const vals = stockValueByCategory([green, roasted]);
    expect(vals.find((v) => v.category === 'GREEN_COFFEE')!.value).toBe(2_000);
    expect(vals.find((v) => v.category === 'ROASTED')!.value).toBe(1_000);
    // sorted descending
    expect(vals[0].category).toBe('GREEN_COFFEE');
  });
});
