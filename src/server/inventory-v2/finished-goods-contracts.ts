export const SELLABLE_INVENTORY_CATEGORIES = ['FINISHED_GOOD', 'ACCESSORY'] as const;

export type FinishedGoodsDefinitionState = 'READY' | 'MISSING' | 'CONFLICT';

export function isSellableInventoryCategory(category: string): category is 'FINISHED_GOOD' | 'ACCESSORY' {
  return SELLABLE_INVENTORY_CATEGORIES.includes(category as 'FINISHED_GOOD' | 'ACCESSORY');
}

export function finishedGoodsCategoryForProductLine(productLine: string): 'FINISHED_GOOD' | 'ACCESSORY' {
  return productLine === 'ACCESSORIES' ? 'ACCESSORY' : 'FINISHED_GOOD';
}

export function finishedGoodsDefinitionState(
  activeItems: ReadonlyArray<{ category: string; branchId: string | null }>,
): FinishedGoodsDefinitionState {
  if (activeItems.length === 0) return 'MISSING';
  if (
    activeItems.length === 1 &&
    activeItems[0].branchId === null &&
    isSellableInventoryCategory(activeItems[0].category)
  ) {
    return 'READY';
  }
  return 'CONFLICT';
}

export function finishedGoodsExternalKey(
  sku: string,
  productId: string,
  occupiedKeys: ReadonlySet<string>,
): string {
  const base = `FG-${sku.trim().toUpperCase()}`;
  if (!occupiedKeys.has(base)) return base;
  const fallback = `${base}-${productId.slice(-8).toUpperCase()}`;
  if (occupiedKeys.has(fallback)) throw new Error('finished_goods_external_key_conflict');
  return fallback;
}
