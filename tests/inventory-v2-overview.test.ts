import { describe, expect, it } from 'vitest';
import type { FinanceEntryLike } from '@/lib/metrics/finance';
import {
  locationCashAccountWhere,
  summarizeLocationCash,
} from '@/server/inventory-v2/overview';

function entry(overrides: Partial<FinanceEntryLike>): FinanceEntryLike {
  return {
    id: 'entry',
    type: 'PAYMENT_IN',
    amount: 0,
    currency: 'IQD',
    obligation: false,
    obligationKind: null,
    accountId: null,
    toAccountId: null,
    settlesId: null,
    ...overrides,
  };
}

describe('Inventory V2 location operations overview', () => {
  it('selects only active IQD cash accounts assigned to the exact location', () => {
    expect(locationCashAccountWhere('sales-point-a')).toEqual({
      stockLocationId: 'sales-point-a',
      isActive: true,
      currency: 'IQD',
      type: 'CASH',
    });
  });

  it('reconciles location cash across receipts, spending, transfers, and reversals', () => {
    const accounts = [
      { id: 'cash-a', openingBalance: 100_000 },
      { id: 'cash-b', openingBalance: 50_000 },
    ];
    const entries = [
      entry({ id: 'sale', accountId: 'cash-a', amount: 20_000 }),
      entry({ id: 'expense', type: 'EXPENSE', accountId: 'cash-b', amount: 5_000 }),
      entry({ id: 'transfer', type: 'TRANSFER', accountId: 'cash-a', toAccountId: 'cash-b', amount: 10_000 }),
      entry({ id: 'reversed', type: 'PAYMENT_IN', accountId: 'cash-a', amount: 99_000, reversedAt: new Date() }),
      entry({ id: 'obligation', type: 'PURCHASE', accountId: 'cash-a', amount: 30_000, obligation: true, obligationKind: 'PAYABLE' }),
    ];
    expect(summarizeLocationCash(accounts, entries)).toBe(165_000);
  });
});
