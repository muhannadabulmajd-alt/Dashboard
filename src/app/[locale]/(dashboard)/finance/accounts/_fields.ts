import { enumLabel, ACCOUNT_TYPES, CURRENCIES } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import type { FieldDef } from '@/components/records/form';

/** Form fields for creating/editing a finance account (shared by new + edit pages). */
export function accountFields(
  t: (key: string) => string,
  locale: AppLocale,
  branchOptions: { value: string; label: string }[],
): FieldDef[] {
  const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: enumLabel(v, locale) }));
  return [
    { name: 'name', label: t('f.name'), type: 'text', required: true, hint: t('h.accountName') },
    { name: 'type', label: t('f.type'), type: 'select', required: true, options: opts(ACCOUNT_TYPES), hint: t('h.accountType') },
    {
      name: 'currency',
      label: t('f.currency'),
      type: 'select',
      required: true,
      options: CURRENCIES.map((c) => ({ value: c, label: c })),
      hint: t('h.currency'),
    },
    { name: 'bankName', label: t('f.bank'), type: 'text', hint: t('h.bank') },
    { name: 'branchId', label: t('f.branch'), type: 'select', options: branchOptions, hint: t('h.branch') },
    { name: 'openingBalance', label: t('f.opening'), type: 'number', hint: t('h.openingBalance') },
    { name: 'notes', label: t('f.notes'), type: 'text', hint: t('h.notes') },
  ];
}
