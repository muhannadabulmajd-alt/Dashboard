import type { LedgerRecordClass } from '@prisma/client';

const PURCHASE_LINE_TYPES = new Set(['INVENTORY', 'ASSET']);
const EXPENSE_LINE_TYPES = new Set(['EXPENSE', 'SERVICE', 'OTHER']);

export function ledgerRecordClassForLines(lines: Array<{ itemType: string }>): LedgerRecordClass {
  const hasPurchase = lines.some((line) => PURCHASE_LINE_TYPES.has(line.itemType));
  const hasExpense = lines.some((line) => EXPENSE_LINE_TYPES.has(line.itemType));
  if (hasPurchase && hasExpense) return 'MIXED';
  if (hasExpense) return 'EXPENSE';
  return 'PURCHASE';
}

export function ledgerRecordClassLabel(value: LedgerRecordClass, locale: 'ar' | 'en'): string {
  const labels: Record<LedgerRecordClass, { ar: string; en: string }> = {
    PURCHASE: { en: 'Purchase', ar: 'شراء' },
    EXPENSE: { en: 'Expense', ar: 'مصروف' },
    MIXED: { en: 'Purchase + expense', ar: 'شراء + مصروف' },
  };
  return labels[value][locale];
}
