import { describe, it, expect } from 'vitest';
import {
  accountBalance,
  financeTotals,
  totalCash,
  type FinanceEntryLike,
} from '@/lib/metrics/finance';

const e = (over: Partial<FinanceEntryLike> & Pick<FinanceEntryLike, 'id' | 'type' | 'amount'>): FinanceEntryLike => ({
  currency: 'IQD',
  obligation: false,
  obligationKind: null,
  accountId: 'cash',
  toAccountId: null,
  settlesId: null,
  ...over,
});

describe('finance metrics', () => {
  it('computes account balance from opening + cash movements', () => {
    const entries = [
      e({ id: '1', type: 'CAPITAL_IN', amount: 1_000_000, accountId: 'bank' }),
      e({ id: '2', type: 'EXPENSE', amount: 200_000, accountId: 'bank' }),
      e({ id: '3', type: 'PAYMENT_IN', amount: 50_000, accountId: 'cash' }),
    ];
    expect(accountBalance({ id: 'bank', openingBalance: 0 }, entries)).toBe(800_000);
    expect(accountBalance({ id: 'cash', openingBalance: 10_000 }, entries)).toBe(60_000);
  });

  it('moves money between accounts on a transfer', () => {
    const entries = [e({ id: 't', type: 'TRANSFER', amount: 300_000, accountId: 'bank', toAccountId: 'cash' })];
    expect(accountBalance({ id: 'bank', openingBalance: 500_000 }, entries)).toBe(200_000);
    expect(accountBalance({ id: 'cash', openingBalance: 0 }, entries)).toBe(300_000);
    expect(totalCash([{ id: 'bank', openingBalance: 500_000 }, { id: 'cash', openingBalance: 0 }], entries)).toBe(500_000);
  });

  it('tracks a payable settled by partial payments', () => {
    const entries = [
      // a 900k payable to a supplier (no cash moved yet)
      e({ id: 'p1', type: 'PURCHASE', amount: 900_000, obligation: true, obligationKind: 'PAYABLE', accountId: null }),
      // two part-payments from the bank
      e({ id: 'pay1', type: 'PAYMENT_OUT', amount: 500_000, accountId: 'bank', settlesId: 'p1' }),
      e({ id: 'pay2', type: 'PAYMENT_OUT', amount: 100_000, accountId: 'bank', settlesId: 'p1' }),
    ];
    const t = financeTotals(entries);
    expect(t.expenses).toBe(900_000); // incurred once (the obligation), not the payments
    expect(t.cashOut).toBe(600_000); // only the two payments moved cash
    expect(t.outstandingPayable).toBe(300_000); // 900k - 600k
  });

  it('tracks a receivable and capital + computes totals per slice', () => {
    const entries = [
      e({ id: 'cap', type: 'CAPITAL_IN', amount: 5_000_000, accountId: 'bank' }),
      e({ id: 'r1', type: 'INCOME', amount: 400_000, obligation: true, obligationKind: 'RECEIVABLE', accountId: null }),
      e({ id: 'rin', type: 'PAYMENT_IN', amount: 150_000, accountId: 'cash', settlesId: 'r1' }),
    ];
    const t = financeTotals(entries);
    expect(t.capitalIn).toBe(5_000_000);
    expect(t.received).toBe(150_000);
    expect(t.outstandingReceivable).toBe(250_000);
    expect(t.cashIn).toBe(5_150_000);
  });
});
