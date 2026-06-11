import { enumLabel, GOVERNORATES, CUSTOMER_SEGMENTS, CUSTOMER_SOURCES } from '@/lib/enums';
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
  sources: readonly string[] = CUSTOMER_SOURCES,
  governorates?: { value: string; label: string }[],
): FieldDef[] {
  const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: enumLabel(v, locale) }));
  return [
    ...(mode === 'edit'
      ? [{ name: 'externalId', label: t('f.externalId'), type: 'text' as const, disabled: true }]
      : []),
    { name: 'nameEn', label: t('f.nameEn'), type: 'text', hint: t('h.customerName') },
    { name: 'nameAr', label: t('f.nameAr'), type: 'text', hint: t('h.customerName') },
    { name: 'phone', label: t('f.phone'), type: 'text', hint: t('h.phone') },
    { name: 'email', label: t('f.email'), type: 'email' },
    { name: 'governorate', label: t('f.governorate'), type: 'select', options: governorates ?? opts(GOVERNORATES) },
    { name: 'address1', label: t('f.address1'), type: 'text', hint: t('h.customerAddress') },
    { name: 'street', label: t('f.street'), type: 'text', hint: t('h.customerAddress') },
    { name: 'segment', label: t('f.segment'), type: 'select', required: true, options: opts(CUSTOMER_SEGMENTS) },
    { name: 'campaignSource', label: t('f.source'), type: 'select', options: sources.map((s) => ({ value: s, label: s })), hint: t('h.customerSource') },
    { name: 'notes', label: t('f.notes'), type: 'text' },
  ];
}
