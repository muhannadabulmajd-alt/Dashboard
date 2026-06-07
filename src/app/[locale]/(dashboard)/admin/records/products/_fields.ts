import { enumLabel, PRODUCT_LINES, GRINDS, ROAST_LEVELS } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import type { FieldDef } from '@/components/records/form';

/** Form fields for creating/editing a product (shared by new + edit pages). */
export function productFields(t: (key: string) => string, locale: AppLocale): FieldDef[] {
  const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: enumLabel(v, locale) }));
  return [
    { name: 'sku', label: t('f.sku'), type: 'text', required: true },
    { name: 'nameEn', label: t('f.nameEn'), type: 'text', required: true },
    { name: 'nameAr', label: t('f.nameAr'), type: 'text', required: true },
    { name: 'productLine', label: t('f.productLine'), type: 'select', required: true, options: opts(PRODUCT_LINES) },
    { name: 'sizeLabel', label: t('f.size'), type: 'text', required: true },
    { name: 'grind', label: t('f.grind'), type: 'select', required: true, options: opts(GRINDS) },
    { name: 'roastLevel', label: t('f.roastLevel'), type: 'select', options: opts(ROAST_LEVELS) },
    { name: 'origin', label: t('f.origin'), type: 'text' },
    { name: 'sellingPrice', label: t('f.price'), type: 'number', required: true },
    { name: 'cogsPerUnit', label: t('f.cost'), type: 'number', required: true },
  ];
}
