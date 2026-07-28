import 'server-only';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';
import type { FinanceEntryLike } from '@/lib/metrics/finance';
import type { OrderLike, OrderLineWithProduct, PnlMetricSnapshot } from '@/lib/metrics';
import { buildPnlSnapshot, salesOrderCount } from '@/lib/metrics';
import { convertToIqd } from '@/lib/money';
import { financeTotals, netCash } from '@/lib/metrics/finance';
import { prisma } from '@/server/db/client';
import {
  getDirectDeliveryCosts,
  getOperatingExpenseFacts,
  getPaymentProcessingCosts,
  type OperatingExpenseFact,
} from '@/server/db/repositories/finance.repo';
import {
  getOrderLines,
  getOrders,
  getPromotionCosts,
} from '@/server/db/repositories/sales.repo';
import { getUsdToIqd } from '@/server/settings';

type Scope = { branchId?: string };

export interface ProfitFacts {
  orders: OrderLike[];
  lines: OrderLineWithProduct[];
  operatingExpenses: OperatingExpenseFact[];
  pnl: PnlMetricSnapshot;
  saleOrderCount: number;
  averageOrderValue: number;
}

export async function getProfitFacts(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<ProfitFacts> {
  const [
    orders,
    lines,
    operatingExpenses,
    directDeliveryCosts,
    paymentProcessingCosts,
    promotionCosts,
  ] = await Promise.all([
    getOrders(filters, scope, range),
    getOrderLines(filters, scope, range),
    getOperatingExpenseFacts(filters, scope, range),
    getDirectDeliveryCosts(filters, scope, range),
    getPaymentProcessingCosts(filters, scope, range),
    getPromotionCosts(filters, scope, range),
  ]);
  const pnl = buildPnlSnapshot(orders, lines, operatingExpenses, {
    directDeliveryCosts,
    paymentProcessingCosts,
    promotionCosts,
  });
  const orderCount = salesOrderCount(orders);
  return {
    orders,
    lines,
    operatingExpenses,
    pnl,
    saleOrderCount: orderCount,
    averageOrderValue: orderCount ? Math.round(pnl.netSales / orderCount) : 0,
  };
}

type PaymentEntry = FinanceEntryLike & {
  date: Date;
  dueDate: Date | null;
};

export interface PaymentFacts {
  rate: number;
  cashAvailable: number;
  receivables: number;
  payables: number;
  cashReceived: number;
  cashPaid: number;
  overdue: {
    receivables: number;
    payables: number;
  };
  openPayableCount: number;
}

export async function getPaymentFacts(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<PaymentFacts> {
  const branchWhere = scope.branchId
    ? { branchId: scope.branchId }
    : filters.branchId?.length
      ? { branchId: { in: filters.branchId } }
      : {};
  const [accounts, entriesRaw, rate] = await Promise.all([
    prisma.financeAccount.findMany({
      where: { isActive: true, ...branchWhere },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        openingBalance: true,
        currency: true,
      },
    }),
    prisma.financeEntry.findMany({
      where: {
        archivedAt: null,
        reversedAt: null,
        reversalOfId: null,
        date: { lte: range.end },
        ...branchWhere,
      },
      select: {
        id: true,
        type: true,
        amount: true,
        currency: true,
        obligation: true,
        obligationKind: true,
        accountId: true,
        toAccountId: true,
        settlesId: true,
        archivedAt: true,
        reversedAt: true,
        reversalOfId: true,
        date: true,
        dueDate: true,
      },
    }),
    getUsdToIqd(),
  ]);
  const entries = entriesRaw as PaymentEntry[];
  const currencies = Array.from(
    new Set([...accounts.map((account) => account.currency), ...entries.map((entry) => entry.currency)]),
  );
  if (!currencies.length) currencies.push('IQD');

  const combined = currencies.reduce(
    (totals, currency) => {
      const currencyEntries = entries.filter((entry) => entry.currency === currency);
      const currencyAccounts = accounts.filter((account) => account.currency === currency);
      const finance = financeTotals(currencyEntries);
      totals.cashAvailable += convertToIqd(
        netCash(currencyAccounts, currencyEntries),
        currency,
        rate,
      );
      totals.payables += convertToIqd(finance.outstandingPayable, currency, rate);
      totals.receivables += convertToIqd(finance.outstandingReceivable, currency, rate);
      return totals;
    },
    { cashAvailable: 0, payables: 0, receivables: 0 },
  );

  const toIqd = (entry: PaymentEntry) => convertToIqd(entry.amount, entry.currency, rate);
  const periodCash = entries.filter(
    (entry) => entry.date >= range.start && !entry.obligation,
  );
  const cashReceived = periodCash
    .filter((entry) => ['INCOME', 'PAYMENT_IN', 'CAPITAL_IN'].includes(entry.type))
    .reduce((sum, entry) => sum + toIqd(entry), 0);
  const cashPaid = periodCash
    .filter((entry) => ['EXPENSE', 'PURCHASE', 'PAYMENT_OUT', 'DRAWING'].includes(entry.type))
    .reduce((sum, entry) => sum + toIqd(entry), 0);

  const settledByObligation = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.settlesId) continue;
    settledByObligation.set(
      entry.settlesId,
      (settledByObligation.get(entry.settlesId) ?? 0) + toIqd(entry),
    );
  }
  const now = new Date();
  let openPayableCount = 0;
  const overdue = { receivables: 0, payables: 0 };
  for (const entry of entries) {
    if (!entry.obligation || !entry.obligationKind) continue;
    const outstanding = Math.max(
      0,
      toIqd(entry) - (settledByObligation.get(entry.id) ?? 0),
    );
    if (entry.obligationKind === 'PAYABLE' && outstanding > 0) openPayableCount += 1;
    if (!entry.dueDate || entry.dueDate >= now || outstanding <= 0) continue;
    if (entry.obligationKind === 'PAYABLE') overdue.payables += outstanding;
    else overdue.receivables += outstanding;
  }

  return {
    rate,
    ...combined,
    cashReceived,
    cashPaid,
    overdue,
    openPayableCount,
  };
}
