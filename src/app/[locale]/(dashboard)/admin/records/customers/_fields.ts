import { enumLabel, GOVERNORATES, CUSTOMER_SEGMENTS } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import type { FieldDef } from '@/components/records/form';

/**
 * Form fields for creating/editing a customer (shared by new + edit pages).
 * The customer ID is auto-generated on create and immutable afterwards (CR-4),
 * so it's omitted from the new form and shown read-only on edit.
 */
export function customerFields(
  t: (key: string) => string,
  locale: AppLocale,
  mode: 'new' | 'edit' = 'new',
): FieldDef[] {
  const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: enumLabel(v, locale) }));
  return [
    ...(mode === 'edit'
      ? [{ name: 'externalId', label: t('f.externalId'), type: 'text' as const, disabled: true }]
      : []),
    { name: 'nameEn', label: t('f.nameEn'), type: 'text' },
    { name: 'nameAr', label: t('f.nameAr'), type: 'text' },
    { name: 'phone', label: t('f.phone'), type: 'text' },
    { name: 'email', label: t('f.email'), type: 'email' },
    { name: 'governorate', label: t('f.governorate'), type: 'select', options: opts(GOVERNORATES) },
    { name: 'segment', label: t('f.segment'), type: 'select', required: true, options: opts(CUSTOMER_SEGMENTS) },
    { name: 'campaignSource', label: t('f.campaign'), type: 'text' },
  ];
}
