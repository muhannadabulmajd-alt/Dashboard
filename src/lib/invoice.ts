export type InvoicePaymentStatus = 'PAID' | 'UNPAID' | 'PARTIAL' | 'REFUNDED' | 'CANCELED';

export type InvoiceOrderLike = {
  id: string;
  status: string;
  grossAmount: number;
  discountAmount: number;
  refundAmount: number;
  deliveryFee: number;
  extraCharges: number;
};

export type InvoiceFinanceEntryLike = {
  id: string;
  orderId: string | null;
  type: string;
  amount: number;
  obligation: boolean;
  obligationKind: 'PAYABLE' | 'RECEIVABLE' | null;
  settlesId: string | null;
  archivedAt?: Date | null;
  reversedAt?: Date | null;
  reversalOfId?: string | null;
};

export function invoiceTotal(order: Pick<InvoiceOrderLike, 'grossAmount' | 'discountAmount' | 'refundAmount' | 'deliveryFee' | 'extraCharges'>): number {
  return Math.max(0, order.grossAmount - order.discountAmount - order.refundAmount + order.deliveryFee + order.extraCharges);
}

export function activeInvoiceFinanceEntry(entry: InvoiceFinanceEntryLike): boolean {
  return !entry.archivedAt && !entry.reversedAt && !entry.reversalOfId;
}

export function invoicePaymentSnapshot(
  order: InvoiceOrderLike,
  entries: InvoiceFinanceEntryLike[],
): {
  total: number;
  paid: number;
  remaining: number;
  status: InvoicePaymentStatus;
  receivableIds: string[];
} {
  const total = invoiceTotal(order);
  const active = entries.filter(activeInvoiceFinanceEntry);
  const receivables = active.filter((entry) => entry.orderId === order.id && entry.obligation && entry.obligationKind === 'RECEIVABLE');
  const receivableIds = receivables.map((entry) => entry.id);
  const paidFromSettlements = active
    .filter((entry) => entry.type === 'PAYMENT_IN' && entry.settlesId != null && receivableIds.includes(entry.settlesId))
    .reduce((sum, entry) => sum + entry.amount, 0);
  const paidDirectly = active
    .filter((entry) => entry.orderId === order.id && !entry.obligation && entry.type === 'INCOME' && !entry.settlesId)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const paid = Math.min(total, paidDirectly + paidFromSettlements);
  const terminal = order.status === 'CANCELLED' || order.status === 'RETURNED' || order.status === 'REFUNDED';
  const remaining = terminal ? 0 : Math.max(0, total - paid);
  return {
    total,
    paid,
    remaining,
    status: invoicePaymentStatus(order.status, total, paid, receivables.length > 0),
    receivableIds,
  };
}

export function invoicePaymentStatus(
  orderStatus: string,
  total: number,
  paid: number,
  hasReceivable: boolean,
): InvoicePaymentStatus {
  if (orderStatus === 'CANCELLED') return 'CANCELED';
  if (orderStatus === 'RETURNED' || orderStatus === 'REFUNDED') return 'REFUNDED';
  if (total <= 0 || paid >= total) return 'PAID';
  if (paid > 0) return 'PARTIAL';
  return hasReceivable || total > 0 ? 'UNPAID' : 'PAID';
}
