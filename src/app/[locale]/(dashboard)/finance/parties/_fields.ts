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
    { name: 'name', label: t('f.name'), type: 'text', required: true, hint: t('h.partyName') },
    { name: 'type', label: t('f.type'), type: 'select', required: true, options: opts(PARTY_TYPES), hint: t('h.partyType') },
    { name: 'phone', label: t('f.phone'), type: 'text', hint: t('h.contact') },
    { name: 'email', label: t('f.email'), type: 'email', hint: t('h.contact') },
    { name: 'address', label: t('f.address'), type: 'text', hint: t('h.address') },
    { name: 'branchId', label: t('f.branch'), type: 'select', options: branchOptions, hint: t('h.branch') },
    { name: 'openingPayable', label: t('f.openingPayable'), type: 'number', hint: t('h.openingPayable') },
    { name: 'openingReceivable', label: t('f.openingReceivable'), type: 'number', hint: t('h.openingReceivable') },
    { name: 'equityShare', label: t('f.equityShare'), type: 'number', step: '0.1', hint: t('h.equityShare') },
    { name: 'notes', label: t('f.notes'), type: 'text', hint: t('h.notes') },
  ];
}
