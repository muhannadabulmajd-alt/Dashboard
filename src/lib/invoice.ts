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
  date?: Date;
  paymentMethod?: string | null;
  party?: {
    id?: string;
    name?: string | null;
    collectsOrderPayments?: boolean;
  } | null;
  account?: {
    name?: string | null;
  } | null;
};

export type InvoicePaymentRoute = 'DIRECT' | 'PROVIDER' | 'CREDIT' | 'NONE';

export type InvoicePaymentSnapshot = {
  total: number;
  paid: number;
  paidRaw: number;
  remaining: number;
  status: InvoicePaymentStatus;
  route: InvoicePaymentRoute;
  receivableIds: string[];
  providerReceivableIds: string[];
  providerCollected: number;
  providerRemitted: number;
  providerFeesOffset: number;
  providerCleared: number;
  providerOutstanding: number;
  providerPartyId: string | null;
  providerName: string | null;
  accountName: string | null;
  paymentMethod: string | null;
  paymentDate: Date | null;
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
): InvoicePaymentSnapshot {
  const total = invoiceTotal(order);
  const active = entries.filter(activeInvoiceFinanceEntry);
  const orderReceivables = active.filter(
    (entry) =>
      entry.orderId === order.id &&
      entry.obligation &&
      entry.obligationKind === 'RECEIVABLE',
  );
  const providerReceivables = orderReceivables.filter(
    (entry) => entry.party?.collectsOrderPayments === true,
  );
  const customerReceivables = orderReceivables.filter(
    (entry) => entry.party?.collectsOrderPayments !== true,
  );
  const providerReceivableIds = providerReceivables.map((entry) => entry.id);
  const receivableIds = customerReceivables.map((entry) => entry.id);
  const providerIdSet = new Set(providerReceivableIds);
  const customerIdSet = new Set(receivableIds);
  const providerSettlements = active.filter(
    (entry) =>
      entry.type === 'PAYMENT_IN' &&
      entry.settlesId != null &&
      providerIdSet.has(entry.settlesId),
  );
  const customerSettlements = active.filter(
    (entry) =>
      entry.type === 'PAYMENT_IN' &&
      entry.settlesId != null &&
      customerIdSet.has(entry.settlesId),
  );
  const providerCustomerSettlements = customerSettlements.filter(
    (entry) => entry.party?.collectsOrderPayments === true,
  );
  const directPayments = active.filter(
    (entry) =>
      entry.orderId === order.id &&
      !entry.obligation &&
      (entry.type === 'INCOME' || entry.type === 'PAYMENT_IN') &&
      !entry.settlesId,
  );
  const providerDirectPayments = directPayments.filter(
    (entry) => entry.party?.collectsOrderPayments === true,
  );
  const customerDirectPayments = directPayments.filter(
    (entry) => entry.party?.collectsOrderPayments !== true,
  );
  const providerDirectTotal = providerDirectPayments.reduce((sum, entry) => sum + entry.amount, 0);
  const providerCustomerSettlementTotal = providerCustomerSettlements.reduce(
    (sum, entry) => sum + entry.amount,
    0,
  );
  const customerSettlementTotal = customerSettlements
    .filter((entry) => entry.party?.collectsOrderPayments !== true)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const providerCollected =
    providerReceivables.reduce((sum, entry) => sum + entry.amount, 0) +
    providerDirectTotal +
    providerCustomerSettlementTotal;
  const providerRemittedRaw =
    providerDirectTotal +
    providerCustomerSettlementTotal +
    providerSettlements
      .filter((entry) => Boolean(entry.account))
      .reduce((sum, entry) => sum + entry.amount, 0);
  const providerFeesOffsetRaw = providerSettlements
    .filter((entry) => !entry.account)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const providerCleared = Math.min(
    providerCollected,
    providerRemittedRaw + providerFeesOffsetRaw,
  );
  const providerRemitted = Math.min(providerCollected, providerRemittedRaw);
  const providerFeesOffset = Math.min(
    Math.max(0, providerCollected - providerRemitted),
    providerFeesOffsetRaw,
  );
  const paidFromSettlements = customerSettlementTotal;
  const paidDirectly = customerDirectPayments.reduce((sum, entry) => sum + entry.amount, 0);
  const paidRaw = paidDirectly + paidFromSettlements + providerCollected;
  const paid = Math.min(total, paidRaw);
  const terminal = order.status === 'CANCELLED' || order.status === 'RETURNED' || order.status === 'REFUNDED';
  const remaining = terminal ? 0 : Math.max(0, total - paid);
  const paymentEvents = [...directPayments, ...customerSettlements, ...providerReceivables]
    .filter((entry) => entry.date)
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  const latestPayment = paymentEvents.at(-1) ?? null;
  const provider =
    providerDirectPayments.find((entry) => entry.party?.name)?.party ??
    providerCustomerSettlements.find((entry) => entry.party?.name)?.party ??
    providerReceivables.find((entry) => entry.party?.name)?.party ??
    null;
  const accountPayment = [...directPayments, ...customerSettlements]
    .reverse()
    .find((entry) => entry.account?.name);
  return {
    total,
    paid,
    paidRaw,
    remaining,
    status: invoicePaymentStatus(order.status, total, paid, orderReceivables.length > 0),
    route:
      providerCollected > 0 || providerCustomerSettlements.length > 0
        ? 'PROVIDER'
        : paidDirectly + paidFromSettlements > 0
          ? 'DIRECT'
          : customerReceivables.length > 0
            ? 'CREDIT'
            : 'NONE',
    receivableIds,
    providerReceivableIds,
    providerCollected,
    providerRemitted,
    providerFeesOffset,
    providerCleared,
    providerOutstanding: Math.max(0, providerCollected - providerCleared),
    providerPartyId: provider?.id ?? null,
    providerName: provider?.name ?? null,
    accountName: accountPayment?.account?.name ?? null,
    paymentMethod: latestPayment?.paymentMethod ?? null,
    paymentDate: latestPayment?.date ?? null,
  };
}

/**
 * Index a mixed set of order entries and settlements once. This avoids each
 * order repeatedly scanning the complete finance-entry collection.
 */
export function groupInvoiceFinanceEntries<T extends InvoiceFinanceEntryLike>(
  entries: T[],
): Map<string, T[]> {
  const orderByEntryId = new Map<string, string>();
  for (const entry of entries) {
    if (entry.orderId) orderByEntryId.set(entry.id, entry.orderId);
  }

  const grouped = new Map<string, T[]>();
  for (const entry of entries) {
    const orderId = entry.orderId ?? (entry.settlesId ? orderByEntryId.get(entry.settlesId) : null);
    if (!orderId) continue;
    const rows = grouped.get(orderId) ?? [];
    if (!rows.some((row) => row.id === entry.id)) rows.push(entry);
    grouped.set(orderId, rows);
  }
  return grouped;
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
