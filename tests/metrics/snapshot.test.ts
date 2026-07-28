import { describe, expect, it } from 'vitest';
import { buildOperatingExpenseBreakdown, buildPnlSnapshot } from '@/lib/metrics/snapshot';
import { makeOrder } from '../fixtures/builders';

describe('canonical metric snapshots', () => {
  it('uses the same accrual P&L contract for every consuming surface', () => {
    const orders = [makeOrder({ grossAmount: 1_000_000, discountAmount: 100_000, refundAmount: 50_000, deliveryCost: 25_000 })];
    const lines = [{ productId: 'p', sku: 'P', quantity: 2, unitGrossPrice: 500_000, lineDiscount: 0, lineNet: 850_000, unitCogsSnapshot: 200_000 }];
    const expenses = [{ amount: 75_000, currency: 'IQD' as const, incurredAt: new Date('2026-06-01'), categoryType: 'RENT' as const }];
    expect(buildPnlSnapshot(orders, lines, expenses, { paymentProcessingCosts: 12_000 })).toEqual({
      grossRevenue: 1_000_000,
      discounts: 100_000,
      refunds: 50_000,
      netSales: 850_000,
      cogs: 400_000,
      grossProfit: 450_000,
      grossMarginPct: 450_000 / 850_000,
      directDeliveryCost: 25_000,
      paymentProcessingCosts: 12_000,
      contributionProfit: 413_000,
      operatingExpenses: 75_000,
      operatingProfit: 338_000,
    });
  });

  it('reconciles every expense chart breakdown to the headline total', () => {
    const facts = [
      { amount: 75_000, currency: 'IQD' as const, incurredAt: new Date('2026-05-10'), categoryType: 'RENT' as const, partyName: 'Landlord' },
      { amount: 25_000, currency: 'IQD' as const, incurredAt: new Date('2026-05-11'), categoryType: 'UTILITIES' as const, partyName: 'Power' },
      { amount: 50_000, currency: 'IQD' as const, incurredAt: new Date('2026-06-01'), categoryType: 'RENT' as const, partyName: 'Landlord' },
    ];
    const result = buildOperatingExpenseBreakdown(facts);
    expect(result.total).toBe(150_000);
    expect(result.byMonth.reduce((sum, row) => sum + row.amount, 0)).toBe(result.total);
    expect(result.byCategory.reduce((sum, row) => sum + row.amount, 0)).toBe(result.total);
    expect(result.byParty.reduce((sum, row) => sum + row.amount, 0)).toBe(result.total);
  });
});
