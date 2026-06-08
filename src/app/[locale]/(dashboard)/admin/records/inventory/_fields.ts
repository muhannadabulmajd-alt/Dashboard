import { enumLabel, INVENTORY_CATEGORIES } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import type { FieldDef } from '@/components/records/form';

/** Form fields for creating/editing an inventory item (shared by new + edit pages). */
export function inventoryFields(
  t: (key: string) => string,
  locale: AppLocale,
  products: { value: string; label: string }[] = [],
): FieldDef[] {
  const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: enumLabel(v, locale) }));
  return [
    { name: 'nameEn', label: t('f.nameEn'), type: 'text', required: true },
    { name: 'nameAr', label: t('f.nameAr'), type: 'text', required: true },
    { name: 'category', label: t('f.category'), type: 'select', required: true, options: opts(INVENTORY_CATEGORIES) },
    { name: 'unit', label: t('f.unit'), type: 'text', required: true },
    { name: 'productId', label: t('f.linkedVariation'), type: 'select', options: products },
    { name: 'reorderPoint', label: t('f.reorderPoint'), type: 'number' },
    { name: 'avgDailyUsage', label: t('f.avgDailyUsage'), type: 'number', step: '0.1' },
    { name: 'unitCost', label: t('f.unitCost'), type: 'number' },
  ];
}
