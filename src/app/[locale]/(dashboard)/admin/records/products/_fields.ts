import { enumLabel, PRODUCT_LINES, GRINDS, ROAST_LEVELS } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import type { FieldDef } from '@/components/records/form';

type Opt = { value: string; label: string };

/**
 * Form fields for creating/editing a product (shared by new + edit pages).
 * SKU is the permanent key — editable on create, immutable afterwards (CR-5).
 * Grind/roast options should come from the managed system lists (§9) so
 * relabels and user-added values apply; the static enums are the fallback.
 */
export function productFields(
  t: (key: string) => string,
  locale: AppLocale,
  mode: 'new' | 'edit' = 'new',
  groups: Opt[] = [],
  lists?: { grinds?: Opt[]; roastLevels?: Opt[] },
): FieldDef[] {
  const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: enumLabel(v, locale) }));
  return [
    { name: 'sku', label: t('f.sku'), type: 'text', required: true, disabled: mode === 'edit', hint: mode === 'edit' ? t('f.skuHint') : undefined },
    { name: 'nameEn', label: t('f.nameEn'), type: 'text', required: true },
    { name: 'nameAr', label: t('f.nameAr'), type: 'text', required: true },
    { name: 'productLine', label: t('f.productLine'), type: 'select', required: true, options: opts(PRODUCT_LINES) },
    { name: 'groupId', label: t('f.group'), type: 'select', options: groups },
    { name: 'variationType', label: t('f.variationType'), type: 'text', placeholder: t('f.variationTypeHint') },
    { name: 'sizeLabel', label: t('f.size'), type: 'text', required: true },
    { name: 'grind', label: t('f.grind'), type: 'select', required: true, options: lists?.grinds ?? opts(GRINDS) },
    { name: 'roastLevel', label: t('f.roastLevel'), type: 'select', options: lists?.roastLevels ?? opts(ROAST_LEVELS) },
    { name: 'origin', label: t('f.origin'), type: 'text' },
    { name: 'imageUrl', label: t('f.imageUrl'), type: 'text', placeholder: 'https://…' },
    { name: 'sellingPrice', label: t('f.price'), type: 'number', required: true },
    { name: 'cogsPerUnit', label: t('f.cost'), type: 'number', required: true, hint: t('f.costHint') },
  ];
}
