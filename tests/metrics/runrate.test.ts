import { describe, it, expect } from 'vitest';
import {
  runRate,
  operatingExpenses,
  expensesByCategory,
  operatingProfit,
  cashBurn,
} from '@/lib/metrics/runrate';
import { deltaPct } from '@/lib/metrics';
import type { ExpenseLike } from '@/lib/metrics/types';

describe('run-rate and cash metrics', () => {
  it('runRate projects MTD to month end', () => {
    // 300k over 10 days -> 30k/day -> 30 days = 900k
    expect(runRate(300_000, 10, 30)).toBe(900_000);
    expect(runRate(300_000, 0, 30)).toBe(0);
  });

  const expenses: ExpenseLike[] = [
    { amount: 100_000, currency: 'IQD', incurredAt: new Date(), categoryType: 'SALARIES' },
    { amount: 50_000, currency: 'IQD', incurredAt: new Date(), categoryType: 'RENT' },
    { amount: 20_000, currency: 'IQD', incurredAt: new Date(), categoryType: 'SALARIES' },
    { amount: 999, currency: 'USD', incurredAt: new Date(), categoryType: 'TECH' }, // other currency
  ];

  it('operatingExpenses sums a single currency only', () => {
    expect(operatingExpenses(expenses, 'IQD')).toBe(170_000);
    expect(operatingExpenses(expenses, 'USD')).toBe(999);
  });

  it('expensesByCategory groups within a currency', () => {
    const byCat = expensesByCategory(expenses, 'IQD');
    expect(byCat.find((c) => c.category === 'SALARIES')!.amount).toBe(120_000);
    expect(byCat[0].category).toBe('SALARIES'); // largest first
  });

  it('operatingProfit and cashBurn are sign-inverse', () => {
    expect(operatingProfit(200_000, 170_000)).toBe(30_000);
    expect(cashBurn(200_000, 170_000)).toBe(-30_000);
    expect(cashBurn(100_000, 170_000)).toBe(70_000); // burning cash
  });

  it('deltaPct guards undefined and zero baselines', () => {
    expect(deltaPct(120, 100)).toBeCloseTo(0.2, 6);
    expect(deltaPct(80, 100)).toBeCloseTo(-0.2, 6);
    expect(deltaPct(120, undefined)).toBeUndefined();
    expect(deltaPct(120, 0)).toBeUndefined();
  });
});
