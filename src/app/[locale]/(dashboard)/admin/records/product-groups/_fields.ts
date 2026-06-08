import { enumLabel, PRODUCT_LINES } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import type { FieldDef } from '@/components/records/form';

/**
 * Fields for a parent product group. The code is auto-generated on create and
 * immutable afterwards (BRD §10), so it's omitted on new and read-only on edit.
 */
export function productGroupFields(
  t: (key: string) => string,
  locale: AppLocale,
  mode: 'new' | 'edit' = 'new',
): FieldDef[] {
  return [
    ...(mode === 'edit' ? [{ name: 'code', label: t('f.code'), type: 'text' as const, disabled: true }] : []),
    { name: 'nameEn', label: t('f.nameEn'), type: 'text', required: true },
    { name: 'nameAr', label: t('f.nameAr'), type: 'text', required: true },
    {
      name: 'productLine',
      label: t('f.productLine'),
      type: 'select',
      required: true,
      options: PRODUCT_LINES.map((v) => ({ value: v, label: enumLabel(v, locale) })),
    },
    { name: 'description', label: t('f.description'), type: 'text' },
  ];
}
