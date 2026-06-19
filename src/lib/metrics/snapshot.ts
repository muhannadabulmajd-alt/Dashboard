import type { ExpenseLike, OrderLike, OrderLineLike } from './types';
import { cogs, grossMargin } from './margin';
import { deliveryCostTotal, discountTotal, grossSales, netSales, refundTotal } from './sales';
import { operatingExpenses, operatingProfit } from './runrate';
import { monthBucketKey } from '@/lib/dates';

export interface PnlMetricSnapshot {
  grossRevenue: number;
  discounts: number;
  refunds: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  directDeliveryCost: number;
  operatingExpenses: number;
  operatingProfit: number;
}

export interface OperatingExpenseFactLike extends ExpenseLike {
  partyName?: string | null;
}

export interface OperatingExpenseBreakdown {
  total: number;
  byMonth: { key: string; amount: number }[];
  byCategory: { key: string; amount: number }[];
  byParty: { key: string; amount: number }[];
}

/** Every operating-expense visualization is derived from this same fact set. */
export function buildOperatingExpenseBreakdown(expenses: OperatingExpenseFactLike[]): OperatingExpenseBreakdown {
  const months = new Map<string, number>();
  const categories = new Map<string, number>();
  const parties = new Map<string, number>();
  let total = 0;
  for (const expense of expenses) {
    total += expense.amount;
    const month = monthBucketKey(expense.incurredAt);
    months.set(month, (months.get(month) ?? 0) + expense.amount);
    categories.set(expense.categoryType, (categories.get(expense.categoryType) ?? 0) + expense.amount);
    if (expense.partyName) parties.set(expense.partyName, (parties.get(expense.partyName) ?? 0) + expense.amount);
  }
  const rows = (map: Map<string, number>) => [...map.entries()].map(([key, amount]) => ({ key, amount }));
  return {
    total,
    byMonth: rows(months).sort((a, b) => a.key.localeCompare(b.key)),
    byCategory: rows(categories).sort((a, b) => b.amount - a.amount),
    byParty: rows(parties).sort((a, b) => b.amount - a.amount),
  };
}

/** Canonical accrual-basis P&L used by every card, report and export. */
export function buildPnlSnapshot(
  orders: OrderLike[],
  lines: OrderLineLike[],
  expenses: ExpenseLike[],
): PnlMetricSnapshot {
  const grossRevenue = grossSales(orders);
  const discounts = discountTotal(orders);
  const refunds = refundTotal(orders);
  const net = netSales(orders);
  const costOfGoods = cogs(lines);
  const gross = grossMargin(net, costOfGoods);
  const directDeliveryCost = deliveryCostTotal(orders);
  const opex = operatingExpenses(expenses, 'IQD');
  return {
    grossRevenue,
    discounts,
    refunds,
    netSales: net,
    cogs: costOfGoods,
    grossProfit: gross.amount,
    grossMarginPct: gross.pct,
    directDeliveryCost,
    operatingExpenses: opex,
    operatingProfit: operatingProfit(gross.amount, opex, directDeliveryCost),
  };
}
