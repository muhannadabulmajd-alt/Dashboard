import { describe, expect, it } from 'vitest';
import { providerFeeAmount, providerFeeCostRole } from '@/lib/provider-fees';

describe('automatic provider fees', () => {
  it('applies the observed Wayl percentage plus fixed fee rule', () => {
    expect(
      providerFeeAmount(28_000, 0, {
        mode: 'PERCENT_PLUS_FIXED',
        feeRateBps: 350,
        fixedFee: 600,
      }),
    ).toBe(1_580);
    expect(providerFeeCostRole('PERCENT_PLUS_FIXED')).toBe('PAYMENT_PROCESSING');
  });

  it('uses the order delivery cost for courier deductions', () => {
    expect(
      providerFeeAmount(27_000, 5_000, {
        mode: 'ORDER_DELIVERY_COST',
        feeRateBps: 0,
        fixedFee: 0,
      }),
    ).toBe(5_000);
    expect(providerFeeCostRole('ORDER_DELIVERY_COST')).toBe('DIRECT_DELIVERY');
  });

  it('never returns a fee larger than the collected amount', () => {
    expect(
      providerFeeAmount(500, 5_000, {
        mode: 'ORDER_DELIVERY_COST',
        feeRateBps: 0,
        fixedFee: 0,
      }),
    ).toBe(500);
  });
});
