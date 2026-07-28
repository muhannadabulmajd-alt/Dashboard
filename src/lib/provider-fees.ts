export type ProviderFeeMode = 'NONE' | 'PERCENT_PLUS_FIXED' | 'ORDER_DELIVERY_COST';

export interface ProviderFeeRule {
  mode: ProviderFeeMode;
  feeRateBps: number;
  fixedFee: number;
}

export function providerFeeAmount(
  grossAmount: number,
  deliveryCost: number,
  rule: ProviderFeeRule,
): number {
  const gross = Math.max(0, Math.trunc(grossAmount));
  if (gross <= 0 || rule.mode === 'NONE') return 0;

  const calculated = rule.mode === 'ORDER_DELIVERY_COST'
    ? Math.max(0, Math.trunc(deliveryCost))
    : Math.round(gross * Math.max(0, rule.feeRateBps) / 10_000) +
      Math.max(0, Math.trunc(rule.fixedFee));

  return Math.min(gross, calculated);
}

export function providerFeeCostRole(mode: ProviderFeeMode) {
  if (mode === 'ORDER_DELIVERY_COST') return 'DIRECT_DELIVERY' as const;
  if (mode === 'PERCENT_PLUS_FIXED') return 'PAYMENT_PROCESSING' as const;
  return null;
}
