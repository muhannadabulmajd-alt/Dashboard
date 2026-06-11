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
  branchOptions: Opt[],
): FieldDef[] {
  const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: enumLabel(v, locale) }));
  return [
    { name: 'type', label: t('f.type'), type: 'select', required: true, options: opts(FINANCE_TYPES), hint: t('h.type') },
    { name: 'amount', label: t('f.amount'), type: 'number', required: true, hint: t('h.amount') },
    { name: 'currency', label: t('f.currency'), type: 'select', required: true, options: CURRENCIES.map((c) => ({ value: c, label: c })), hint: t('h.currency') },
    { name: 'rate', label: t('f.rate'), type: 'number', step: '1', placeholder: t('f.ratePlaceholder'), showWhen: { field: 'currency', in: ['USD'] }, hint: t('h.rate') },
    { name: 'date', label: t('f.date'), type: 'date', required: true, hint: t('h.date') },
    {
      name: 'obligation',
      label: t('f.obligation'),
      type: 'select',
      required: true,
      options: [
        { value: 'no', label: t('f.paid') },
        { value: 'yes', label: t('f.due') },
      ],
      hint: t('h.paymentStatus'),
    },
    { name: 'obligationKind', label: t('f.kind'), type: 'select', options: opts(OBLIGATION_KINDS), hint: t('h.kind') },
    { name: 'dueDate', label: t('f.dueDate'), type: 'date', hint: t('h.dueDate') },
    { name: 'accountId', label: t('f.account'), type: 'select', options: accountOptions, hint: t('h.account') },
    { name: 'toAccountId', label: t('f.toAccount'), type: 'select', options: accountOptions, hint: t('h.toAccount') },
    { name: 'partyId', label: t('f.party'), type: 'select', options: partyOptions, hint: t('h.party') },
    { name: 'branchId', label: t('f.branch'), type: 'select', options: branchOptions, hint: t('h.branch') },
    { name: 'categoryType', label: t('f.category'), type: 'select', options: opts(EXPENSE_CATEGORY_TYPES), hint: t('h.category') },
    { name: 'description', label: t('f.description'), type: 'text', hint: t('h.description') },
    { name: 'reference', label: t('f.reference'), type: 'text', hint: t('h.reference') },
    { name: 'attachmentUrl', label: t('f.attachmentUrl'), type: 'text', hint: t('h.attachmentUrl') },
  ];
}
