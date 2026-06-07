import { enumLabel, FINANCE_TYPES, CURRENCIES, OBLIGATION_KINDS, EXPENSE_CATEGORY_TYPES } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import type { FieldDef } from '@/components/records/form';

type Opt = { value: string; label: string };

/** Fields for recording/editing a finance ledger entry (shared by new + edit). */
export function entryFields(
  t: (key: string) => string,
  locale: AppLocale,
  accountOptions: Opt[],
  partyOptions: Opt[],
): FieldDef[] {
  const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: enumLabel(v, locale) }));
  return [
    { name: 'type', label: t('f.type'), type: 'select', required: true, options: opts(FINANCE_TYPES) },
    { name: 'amount', label: t('f.amount'), type: 'number', required: true },
    { name: 'currency', label: t('f.currency'), type: 'select', required: true, options: CURRENCIES.map((c) => ({ value: c, label: c })) },
    { name: 'date', label: t('f.date'), type: 'date', required: true },
    {
      name: 'obligation',
      label: t('f.obligation'),
      type: 'select',
      required: true,
      options: [
        { value: 'no', label: t('f.paid') },
        { value: 'yes', label: t('f.due') },
      ],
    },
    { name: 'obligationKind', label: t('f.kind'), type: 'select', options: opts(OBLIGATION_KINDS) },
    { name: 'dueDate', label: t('f.dueDate'), type: 'date' },
    { name: 'accountId', label: t('f.account'), type: 'select', options: accountOptions },
    { name: 'toAccountId', label: t('f.toAccount'), type: 'select', options: accountOptions },
    { name: 'partyId', label: t('f.party'), type: 'select', options: partyOptions },
    { name: 'categoryType', label: t('f.category'), type: 'select', options: opts(EXPENSE_CATEGORY_TYPES) },
    { name: 'description', label: t('f.description'), type: 'text' },
    { name: 'reference', label: t('f.reference'), type: 'text' },
  ];
}
