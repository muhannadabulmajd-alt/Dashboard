import 'server-only';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';
import { monthProgress } from '@/lib/dates';
import { formatMoney, formatNumber, formatPercent } from '@/lib/money';
import { can } from '@/lib/rbac';
import type { CurrentUser } from '@/server/auth/session';
import { getOrders, getPrevOrders, getOrderLines } from '@/server/db/repositories/sales.repo';
import { getInventoryItems } from '@/server/db/repositories/inventory.repo';
import { getExpenses } from '@/server/db/repositories/finance.repo';
import { getShipments } from '@/server/db/repositories/fulfillment.repo';
import { getCustomers } from '@/server/db/repositories/customers.repo';
import * as M from '@/lib/metrics';

export interface DeckKpi {
  label: string;
  value: string;
}

export interface DeckData {
  generatedAt: Date;
  periodLabel: string;
  showFinancial: boolean;
  executive: DeckKpi[];
  topProducts: { name: string; units: number; netSales: number }[];
  byChannel: { name: string; netSales: number }[];
  inventory: { stockValue: number; reorderCount: number; expiryCount: number; alerts: string[] };
  customers: { active: number; newCount: number; returning: number; repeatRate: number };
  fulfillment: { slaPct: number; avgDeliveryDays: number; returnRate: number };
  pnl?: {
    gross: number;
    discounts: number;
    refunds: number;
    net: number;
    cogs: number;
    grossMargin: number;
    opex: number;
    operatingProfit: number;
  };
  actions: string[];
}

/** Gather everything the management deck needs, reusing repos + metrics. */
export async function buildDeckData(
  user: CurrentUser,
  filters: DashboardFilters,
  scope: { branchId?: string },
  range: ResolvedRange,
  periodLabel: string,
): Promise<DeckData> {
  const showFinancial = can(user.role, 'view:financial');
  const L = 'en' as const;

  const [orders, prevOrders, lines, items, expenses, shipments, customers] = await Promise.all([
    getOrders(filters, scope, range),
    getPrevOrders(filters, scope, range),
    getOrderLines(filters, scope, range),
    getInventoryItems(filters, scope, range),
    showFinancial ? getExpenses(filters, scope, range) : Promise.resolve([]),
    getShipments(filters, scope, range),
    getCustomers(scope),
  ]);

  const net = M.netSales(orders);
  const prevNet = M.netSales(prevOrders);
  const orderCount = M.completedOrderCount(orders);
  const units = M.unitsSold(lines);
  const cogs = M.cogs(lines);
  const margin = M.grossMargin(net, cogs);
  const opex = M.operatingExpenses(expenses, 'IQD');
  const profit = M.operatingProfit(margin.amount, opex);
  const { dayOfMonth, daysInMonth } = monthProgress();

  const pct = (n: number, p: number) => {
    const d = M.deltaPct(n, p);
    return d === undefined ? '' : ` (${d >= 0 ? '+' : ''}${formatPercent(d, L)})`;
  };

  const executive: DeckKpi[] = [
    { label: 'Net sales', value: formatMoney(net, 'IQD', L) + pct(net, prevNet) },
    { label: 'Orders', value: formatNumber(orderCount, L) },
    { label: 'Units sold', value: formatNumber(units, L) },
    { label: 'Avg order value', value: formatMoney(M.aov(net, orderCount), 'IQD', L) },
  ];
  if (showFinancial) {
    executive.push(
      { label: 'Gross margin', value: formatPercent(margin.pct, L) },
      { label: 'Net cash', value: formatMoney(profit, 'IQD', L) },
      { label: 'Run rate', value: formatMoney(M.runRate(net, dayOfMonth, daysInMonth), 'IQD', L) },
    );
  }

  const topProducts = M.topProducts(lines, 8).map((p) => ({
    name: p.name.en,
    units: p.units,
    netSales: p.netSales,
  }));
  const byChannel = M.salesByDimension(orders, 'channel').map((b) => ({ name: b.key, netSales: b.netSales }));

  const reorder = M.reorderAlerts(items);
  const expiry = M.nearExpiry(items, 21);
  const stockValue = items.reduce((s, it) => s + M.stockRow(it).value, 0);

  const firstOrderById = new Map(customers.map((c) => [c.id, c.firstOrderAt] as const));
  const nr = M.classifyNewReturning(orders, firstOrderById, range.start, range.end);

  // Action plan — computed, prioritized insights.
  const actions: string[] = [];
  if (showFinancial) {
    const lowMargin = M.productMargin(lines).filter((r) => r.netSales > 0 && r.marginPct < 0.3);
    if (lowMargin.length) {
      actions.push(
        `${lowMargin.length} product(s) below 30% margin — review pricing/COGS (e.g. ${lowMargin
          .slice(0, 3)
          .map((r) => r.name.en)
          .join(', ')}).`,
      );
    }
  }
  if (reorder.length) {
    actions.push(
      `${reorder.length} item(s) at/under reorder point — restock soon (${reorder
        .slice(0, 3)
        .map((r) => r.item.nameEn)
        .join(', ')}).`,
    );
  }
  if (expiry.length) actions.push(`${expiry.length} roasted lot(s) near expiry within 21 days — prioritize for sale.`);
  const returnRate = M.returnRate(orders);
  if (returnRate > 0.08) actions.push(`Return rate is ${formatPercent(returnRate, L)} — investigate fulfillment quality.`);
  if (topProducts[0]) actions.push(`Top seller: ${topProducts[0].name} (${formatMoney(topProducts[0].netSales, 'IQD', L)}).`);
  if (M.deltaPct(net, prevNet) !== undefined && (M.deltaPct(net, prevNet) ?? 0) < 0) {
    actions.push('Net sales are down vs the previous period — review channel and city performance.');
  }
  if (!actions.length) actions.push('No critical issues detected for the selected period.');

  return {
    generatedAt: new Date(),
    periodLabel,
    showFinancial,
    executive,
    topProducts,
    byChannel,
    inventory: {
      stockValue,
      reorderCount: reorder.length,
      expiryCount: expiry.length,
      alerts: reorder.slice(0, 6).map((r) => r.item.nameEn),
    },
    customers: { active: nr.total, newCount: nr.newCount, returning: nr.returning, repeatRate: M.repeatPurchaseRate(nr) },
    fulfillment: {
      slaPct: M.deliverySlaPct(shipments, 3),
      avgDeliveryDays: M.avgDeliveryDays(shipments),
      returnRate,
    },
    pnl: showFinancial
      ? {
          gross: M.grossSales(orders),
          discounts: M.discountTotal(orders),
          refunds: M.refundTotal(orders),
          net,
          cogs,
          grossMargin: margin.amount,
          opex,
          operatingProfit: profit,
        }
      : undefined,
    actions,
  };
}
