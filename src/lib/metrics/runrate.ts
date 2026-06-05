import type { ExpenseCategoryType } from '@prisma/client';
import type { ExpenseLike } from './types';

/** Month-to-date value projected to month end. */
export function runRate(mtdValue: number, dayOfMonth: number, daysInMonth: number): number {
  return dayOfMonth > 0 ? (mtdValue / dayOfMonth) * daysInMonth : 0;
}

/** Total operating expenses (in a single currency) over the supplied rows. */
export function operatingExpenses(expenses: ExpenseLike[], currency: ExpenseLike['currency'] = 'IQD'): number {
  return expenses.filter((e) => e.currency === currency).reduce((s, e) => s + e.amount, 0);
}

export function expensesByCategory(
  expenses: ExpenseLike[],
  currency: ExpenseLike['currency'] = 'IQD',
): { category: ExpenseCategoryType; amount: number }[] {
  const map = new Map<ExpenseCategoryType, number>();
  for (const e of expenses) {
    if (e.currency !== currency) continue;
    map.set(e.categoryType, (map.get(e.categoryType) ?? 0) + e.amount);
  }
  return [...map.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Operating profit / cash position = gross margin - operating expenses.
 * Negative values represent cash burn.
 */
export function operatingProfit(grossMarginValue: number, operatingExpensesValue: number): number {
  return grossMarginValue - operatingExpensesValue;
}

/** Cash burn as a positive number when the business is consuming cash. */
export function cashBurn(grossMarginValue: number, operatingExpensesValue: number): number {
  return operatingExpensesValue - grossMarginValue;
}
