import { describe, it, expect } from 'vitest';
import { cogs, grossMargin, contributionMargin, productMargin, costPerKg } from '@/lib/metrics/margin';
import { makeLine, makeProduct } from '../fixtures/builders';

describe('margin metrics', () => {
  const lines = [
    makeLine({ quantity: 3, lineNet: 30_000, unitCogsSnapshot: 6_000 }),
    makeLine({ quantity: 2, lineNet: 25_000, unitCogsSnapshot: 7_000 }),
  ];

  it('cogs sums unit cost x quantity', () => {
    expect(cogs(lines)).toBe(3 * 6_000 + 2 * 7_000); // 32_000
  });

  it('grossMargin computes amount and pct', () => {
    const gm = grossMargin(55_000, 32_000);
    expect(gm.amount).toBe(23_000);
    expect(gm.pct).toBeCloseTo(23_000 / 55_000, 6);
  });

  it('grossMargin guards zero net sales', () => {
    expect(grossMargin(0, 0)).toEqual({ amount: 0, pct: 0 });
  });

  it('contributionMargin subtracts direct costs', () => {
    expect(contributionMargin(55_000, 32_000, { delivery: 3_000, discount: 2_000 })).toBe(18_000);
  });

  it('productMargin aggregates per product', () => {
    const p = makeProduct({ id: 'x', nameEn: 'X' });
    const rows = productMargin([
      makeLine({ product: p, quantity: 2, lineNet: 20_000, unitCogsSnapshot: 6_000 }),
      makeLine({ product: p, quantity: 1, lineNet: 10_000, unitCogsSnapshot: 6_000 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].netSales).toBe(30_000);
    expect(rows[0].cogs).toBe(18_000);
    expect(rows[0].marginAmount).toBe(12_000);
    expect(rows[0].marginPct).toBeCloseTo(0.4, 6);
  });

  it('costPerKg converts grams to kg', () => {
    // 9000 IQD batch cost, 1500g output -> 6000 IQD/kg
    expect(costPerKg(9_000, 1_500)).toBe(6_000);
    expect(costPerKg(9_000, 0)).toBe(0);
  });
});
