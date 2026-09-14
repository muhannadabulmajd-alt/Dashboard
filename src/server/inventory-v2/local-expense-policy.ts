import { LOCAL_OPEX_CATEGORY_TYPES } from '@/lib/enums';

export const LOCAL_EXPENSE_RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

export type LocalOpexCategory = (typeof LOCAL_OPEX_CATEGORY_TYPES)[number];

export type LocalExpensePolicySnapshot = {
  isActive: boolean;
  allowedCategories: readonly string[];
  maxImmediateAmount: number;
  receiptRequiredAbove: number;
} | null;

export type LocalExpenseAccountSnapshot = {
  isActive: boolean;
  currency: string;
  type: string;
  branchId: string | null;
  stockLocationId: string | null;
};

export function isRoutineLocalExpenseCategory(value: string): value is LocalOpexCategory {
  return LOCAL_OPEX_CATEGORY_TYPES.includes(value as LocalOpexCategory);
}

export function localExpenseAccountMatchesLocation(
  account: LocalExpenseAccountSnapshot,
  location: { id: string; branchId: string },
): boolean {
  if (!account.isActive || account.currency !== 'IQD' || account.type === 'PAYMENT_GATEWAY') return false;
  return account.stockLocationId === location.id;
}

export function localExpenseRequiresReview(
  policy: LocalExpensePolicySnapshot,
  input: { amount: number; categoryType: string; hasReceipt: boolean },
): boolean {
  if (!policy?.isActive) return true;
  if (!isRoutineLocalExpenseCategory(input.categoryType)) return true;
  if (!policy.allowedCategories.includes(input.categoryType)) return true;
  if (input.amount > policy.maxImmediateAmount) return true;
  if (!input.hasReceipt && input.amount > policy.receiptRequiredAbove) return true;
  return false;
}
