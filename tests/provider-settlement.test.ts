import { describe, expect, it } from 'vitest';
import { allocateProviderDeposit } from '../src/lib/provider-settlement';

const row = (orderId: string, receivableOutstanding: number, feeOutstanding = 0) => ({
  orderId,
  receivableId: `ar-${orderId}`,
  receivableOutstanding,
  feePayableId: feeOutstanding ? `ap-${orderId}` : null,
  feeOutstanding,
});

describe('provider settlement allocation', () => {
  it('allocates a net deposit oldest first and offsets linked fees', () => {
    expect(allocateProviderDeposit([row('one', 25_000, 5_000), row('two', 30_000, 5_000)], 45_000, true)).toEqual([
      expect.objectContaining({ orderId: 'one', cashApplied: 20_000, feeOffset: 5_000, fullySettled: true }),
      expect.objectContaining({ orderId: 'two', cashApplied: 25_000, feeOffset: 5_000, fullySettled: true }),
    ]);
  });

  it('leaves the final order partial without prematurely offsetting its fee', () => {
    expect(allocateProviderDeposit([row('one', 25_000, 5_000), row('two', 30_000, 5_000)], 30_000, true)).toEqual([
      expect.objectContaining({ orderId: 'one', cashApplied: 20_000, feeOffset: 5_000, fullySettled: true }),
      expect.objectContaining({ orderId: 'two', cashApplied: 10_000, feeOffset: 0, fullySettled: false }),
    ]);
  });

  it('does not offset fees for gross-settlement providers', () => {
    expect(allocateProviderDeposit([row('wayl', 25_000, 5_000)], 25_000, false)).toEqual([
      expect.objectContaining({ cashApplied: 25_000, feeOffset: 0, grossCleared: 25_000 }),
    ]);
  });

  it('rejects money above the open provider balance', () => {
    expect(() => allocateProviderDeposit([row('one', 25_000, 5_000)], 20_001, true)).toThrow('amount_exceeds_open');
  });
});
