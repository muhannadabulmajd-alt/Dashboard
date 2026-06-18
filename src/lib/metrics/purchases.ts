import type { ExpenseCategoryType } from '@prisma/client';

export type PurchaseBucket = 'OPERATING_EXPENSE' | 'INVENTORY' | 'FIXED_ASSET' | 'UNCLASSIFIED';

export interface PurchaseLineFact {
  itemType: string;
  lineTotal: number;
  categoryType: ExpenseCategoryType | null;
  branchId?: string | null;
}

export interface PurchaseFactInput {
  amount: number;
  categoryType: ExpenseCategoryType | null;
  ledgerLines: PurchaseLineFact[];
  hasFixedAsset: boolean;
  hasInventoryLayer: boolean;
}

export interface PurchaseAllocation {
  operatingExpense: number;
  inventory: number;
  fixedAsset: number;
  unclassified: number;
}

const OPERATING_CATEGORIES = new Set<ExpenseCategoryType>([
  'SHIPPING',
  'SALARIES',
  'RENT',
  'MARKETING',
  'UTILITIES',
  'TECH',
  'MAINTENANCE',
  'OVERHEAD',
]);

const ASSET_LIKE_CATEGORIES = new Set<ExpenseCategoryType>(['GREEN_COFFEE', 'PACKAGING', 'EQUIPMENT']);

export function purchaseBucketForLine(line: PurchaseLineFact): PurchaseBucket {
  if (line.itemType === 'INVENTORY') return 'INVENTORY';
  if (line.itemType === 'EXPENSE' || line.itemType === 'SERVICE' || line.itemType === 'OTHER') return 'OPERATING_EXPENSE';
  return 'UNCLASSIFIED';
}

export function classifyPurchase(input: PurchaseFactInput): PurchaseAllocation {
  const result: PurchaseAllocation = { operatingExpense: 0, inventory: 0, fixedAsset: 0, unclassified: 0 };
  if (input.ledgerLines.length) {
    for (const line of input.ledgerLines) {
      const bucket = purchaseBucketForLine(line);
      if (bucket === 'OPERATING_EXPENSE') result.operatingExpense += line.lineTotal;
      else if (bucket === 'INVENTORY') result.inventory += line.lineTotal;
      else result.unclassified += line.lineTotal;
    }
    return result;
  }
  if (input.hasFixedAsset) result.fixedAsset = input.amount;
  else if (input.hasInventoryLayer) result.inventory = input.amount;
  else if (input.categoryType && OPERATING_CATEGORIES.has(input.categoryType)) result.operatingExpense = input.amount;
  else if (input.categoryType && ASSET_LIKE_CATEGORIES.has(input.categoryType)) result.unclassified = input.amount;
  else result.unclassified = input.amount;
  return result;
}

export function allocationTotal(allocation: PurchaseAllocation): number {
  return allocation.operatingExpense + allocation.inventory + allocation.fixedAsset + allocation.unclassified;
}
