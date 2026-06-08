import { describe, it, expect } from 'vitest';
import {
  accountBalance,
  financeTotals,
  totalCash,
  netCash,
  unassignedCash,
  agingBuckets,
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

  it('counts account-less cash movements (e.g. imports) in net cash', () => {
    // Imported purchases/capital have obligation=false and NO account, yet they
    // are real cash movements. totalCash (per-account) misses them; netCash must
    // include them so the balance sheet cash isn't understated.
    const entries = [
      e({ id: 'cap', type: 'CAPITAL_IN', amount: 50_000_000, accountId: null }),
      e({ id: 'pur', type: 'PURCHASE', amount: 18_000_000, accountId: null }),
      e({ id: 'manual', type: 'EXPENSE', amount: 2_000_000, accountId: 'bank' }),
    ];
    const accounts = [{ id: 'bank', openingBalance: 1_000_000 }];
    // Per-account view only sees opening + the account-tied expense.
    expect(totalCash(accounts, entries)).toBe(-1_000_000);
    // Account-less net effect: +50M capital - 18M purchase = 32M.
    expect(unassignedCash(entries)).toBe(32_000_000);
    // True cash = -1M (accounts) + 32M (unassigned) = 31M.
    expect(netCash(accounts, entries)).toBe(31_000_000);
  });

  it('excludes obligations and transfers from unassigned cash', () => {
    const entries = [
      e({ id: 'due', type: 'PURCHASE', amount: 9_000_000, obligation: true, obligationKind: 'PAYABLE', accountId: null }),
      e({ id: 'xfer', type: 'TRANSFER', amount: 5_000_000, accountId: 'bank', toAccountId: 'cash' }),
      e({ id: 'spend', type: 'PURCHASE', amount: 3_000_000, accountId: null }),
    ];
    expect(unassignedCash(entries)).toBe(-3_000_000); // only the real account-less purchase
  });

  it('buckets dues by age (0-30 / 30-60 / 60+)', () => {
    const asOf = new Date('2026-06-30T00:00:00Z');
    const b = agingBuckets(
      [
        { outstanding: 100, refDate: new Date('2026-06-20T00:00:00Z') }, // 10d → 0-30
        { outstanding: 200, refDate: new Date('2026-05-20T00:00:00Z') }, // 41d → 30-60
        { outstanding: 300, refDate: new Date('2026-03-01T00:00:00Z') }, // 121d → 60+
      ],
      asOf,
    );
    expect(b.d0_30).toBe(100);
    expect(b.d30_60).toBe(200);
    expect(b.d60plus).toBe(300);
    expect(b.total).toBe(600);
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
