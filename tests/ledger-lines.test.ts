import { describe, expect, it } from 'vitest';
import { ledgerLineTotalMinor, ledgerPaymentSnapshot, ledgerUnitCostMinor } from '@/lib/ledger-lines';

describe('ledger line helpers', () => {
  it('calculates line totals with three-decimal quantities, discount, and extra cost', () => {
    expect(ledgerLineTotalMinor({ quantity: 1.25, unitCostMinor: 400, discountMinor: 50, extraMinor: 25 })).toBe(475);
    expect(ledgerUnitCostMinor(475, 1.25)).toBe('380.000');
  });

  it('derives unpaid, partial, and paid status from payments', () => {
    expect(ledgerPaymentSnapshot(1_000_000, 0)).toMatchObject({ remaining: 1_000_000, status: 'UNPAID' });
    expect(ledgerPaymentSnapshot(1_000_000, 300_000)).toMatchObject({ paid: 300_000, remaining: 700_000, status: 'PARTIAL' });
    expect(ledgerPaymentSnapshot(1_000_000, 1_500_000)).toMatchObject({ paid: 1_000_000, remaining: 0, status: 'PAID' });
  });

  it('marks reversed records separately from payment progress', () => {
    expect(ledgerPaymentSnapshot(1_000_000, 300_000, { reversed: true })).toMatchObject({ remaining: 0, status: 'REVERSED' });
  });
});
