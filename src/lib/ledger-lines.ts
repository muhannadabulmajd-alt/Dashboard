export type LedgerPaymentStatus = 'PAID' | 'UNPAID' | 'PARTIAL' | 'REFUNDED' | 'CANCELED' | 'REVERSED';

export type LedgerLineMathInput = {
  quantity: number;
  unitCostMinor: number;
  discountMinor?: number;
  extraMinor?: number;
};

export type LedgerPaymentSnapshot = {
  total: number;
  paid: number;
  remaining: number;
  status: LedgerPaymentStatus;
};

export function ledgerLineTotalMinor(input: LedgerLineMathInput): number {
  const base = input.quantity * input.unitCostMinor;
  return Math.max(0, Math.round(base) - Math.max(0, input.discountMinor ?? 0) + Math.max(0, input.extraMinor ?? 0));
}

export function ledgerUnitCostMinor(totalMinor: number, quantity: number): string {
  if (!Number.isFinite(quantity) || quantity <= 0) return '0.000';
  return (totalMinor / quantity).toFixed(3);
}

export function ledgerPaymentSnapshot(
  total: number,
  paid: number,
  state: { reversed?: boolean; canceled?: boolean; refunded?: boolean } = {},
): LedgerPaymentSnapshot {
  if (state.canceled) return { total, paid, remaining: 0, status: 'CANCELED' };
  if (state.refunded) return { total, paid, remaining: 0, status: 'REFUNDED' };
  if (state.reversed) return { total, paid, remaining: 0, status: 'REVERSED' };
  const cleanPaid = Math.max(0, Math.min(total, paid));
  const remaining = Math.max(0, total - cleanPaid);
  const status: LedgerPaymentStatus = remaining <= 0 ? 'PAID' : cleanPaid > 0 ? 'PARTIAL' : 'UNPAID';
  return { total, paid: cleanPaid, remaining, status };
}

export function ledgerPaymentStatusLabel(status: LedgerPaymentStatus, locale: 'ar' | 'en'): string {
  const labels: Record<LedgerPaymentStatus, { en: string; ar: string }> = {
    PAID: { en: 'Paid', ar: 'مدفوع' },
    UNPAID: { en: 'Unpaid', ar: 'غير مدفوع' },
    PARTIAL: { en: 'Partially paid', ar: 'مدفوع جزئياً' },
    REFUNDED: { en: 'Refunded', ar: 'مسترد' },
    CANCELED: { en: 'Canceled', ar: 'ملغى' },
    REVERSED: { en: 'Reversed', ar: 'معكوس' },
  };
  return labels[status][locale];
}
