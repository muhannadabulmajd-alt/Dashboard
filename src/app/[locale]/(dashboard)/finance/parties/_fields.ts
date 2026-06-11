import { enumLabel, PARTY_TYPES } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import type { FieldDef } from '@/components/records/form';

/** Form fields for creating/editing a party (shared by new + edit pages). */
export function partyFields(
  t: (key: string) => string,
  locale: AppLocale,
  branchOptions: { value: string; label: string }[],
): FieldDef[] {
  const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: enumLabel(v, locale) }));
  return [
    { name: 'name', label: t('f.name'), type: 'text', required: true },
    { name: 'type', label: t('f.type'), type: 'select', required: true, options: opts(PARTY_TYPES) },
    { name: 'phone', label: t('f.phone'), type: 'text' },
    { name: 'email', label: t('f.email'), type: 'email' },
    { name: 'address', label: t('f.address'), type: 'text' },
    { name: 'branchId', label: t('f.branch'), type: 'select', options: branchOptions },
    { name: 'openingPayable', label: t('f.openingPayable'), type: 'number' },
    { name: 'openingReceivable', label: t('f.openingReceivable'), type: 'number' },
    { name: 'equityShare', label: t('f.equityShare'), type: 'number', step: '0.1' },
    { name: 'notes', label: t('f.notes'), type: 'text' },
  ];
}
