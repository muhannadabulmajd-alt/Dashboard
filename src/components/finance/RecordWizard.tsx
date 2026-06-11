'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ArrowLeft, ChevronRight } from 'lucide-react';
import { createEntry } from '@/server/finance/entries';
import { Link } from '@/i18n/navigation';
import type { ActionState } from '@/server/records/shared';

type Opt = { value: string; label: string };
type FieldKey = 'amount' | 'currency' | 'date' | 'account' | 'toAccount' | 'party' | 'category' | 'dueDate' | 'branch' | 'description' | 'reference' | 'attachmentUrl';
type Group = 'in' | 'out' | 'due' | 'transfer';

const FIELD_HELP: Record<FieldKey, string> = {
  amount: 'h.amount',
  currency: 'h.currency',
  date: 'h.date',
  account: 'h.account',
  toAccount: 'h.toAccount',
  party: 'h.party',
  category: 'h.category',
  dueDate: 'h.dueDate',
  branch: 'h.branch',
  description: 'h.description',
  reference: 'h.reference',
  attachmentUrl: 'h.attachmentUrl',
};

interface RecordOption {
  key: string;
  group: Group;
  type: string; // FinanceType
  obligation?: boolean;
  obligationKind?: 'PAYABLE' | 'RECEIVABLE';
  fields: FieldKey[];
  note?: 'settle'; // shows a "to settle a specific due, use Dues" hint
}

// Simple business choices → the ledger's type/obligation/account shape (§7–8).
const OPTIONS: RecordOption[] = [
  { key: 'salesIncome', group: 'in', type: 'INCOME', fields: ['amount', 'currency', 'date', 'account', 'party', 'description'] },
  { key: 'paymentReceived', group: 'in', type: 'PAYMENT_IN', fields: ['amount', 'currency', 'date', 'account', 'party', 'reference', 'description'], note: 'settle' },
  { key: 'orderPayment', group: 'in', type: 'PAYMENT_IN', fields: ['amount', 'currency', 'date', 'account', 'party', 'reference', 'branch', 'description'], note: 'settle' },
  { key: 'capital', group: 'in', type: 'CAPITAL_IN', fields: ['amount', 'currency', 'date', 'account', 'party', 'description'] },
  { key: 'cashAdjustmentUp', group: 'in', type: 'INCOME', fields: ['amount', 'currency', 'date', 'account', 'branch', 'reference', 'description'] },
  { key: 'otherIn', group: 'in', type: 'INCOME', fields: ['amount', 'currency', 'date', 'account', 'description'] },

  { key: 'expensePaid', group: 'out', type: 'EXPENSE', fields: ['amount', 'currency', 'date', 'account', 'category', 'party', 'description'] },
  { key: 'purchasePaid', group: 'out', type: 'PURCHASE', fields: ['amount', 'currency', 'date', 'account', 'party', 'category', 'description'] },
  { key: 'inventoryPurchase', group: 'out', type: 'PURCHASE', fields: ['amount', 'currency', 'date', 'account', 'party', 'category', 'branch', 'reference', 'attachmentUrl', 'description'] },
  { key: 'supplierPayment', group: 'out', type: 'PAYMENT_OUT', fields: ['amount', 'currency', 'date', 'account', 'party', 'reference', 'description'], note: 'settle' },
  { key: 'withdrawal', group: 'out', type: 'DRAWING', fields: ['amount', 'currency', 'date', 'account', 'party', 'description'] },
  { key: 'refund', group: 'out', type: 'PAYMENT_OUT', fields: ['amount', 'currency', 'date', 'account', 'party', 'reference', 'description'] },
  { key: 'cashAdjustmentDown', group: 'out', type: 'EXPENSE', fields: ['amount', 'currency', 'date', 'account', 'branch', 'reference', 'description'] },
  { key: 'otherOut', group: 'out', type: 'EXPENSE', fields: ['amount', 'currency', 'date', 'account', 'category', 'description'] },

  { key: 'expenseLater', group: 'due', type: 'EXPENSE', obligation: true, obligationKind: 'PAYABLE', fields: ['amount', 'currency', 'date', 'party', 'category', 'dueDate', 'description'] },
  { key: 'purchaseCredit', group: 'due', type: 'PURCHASE', obligation: true, obligationKind: 'PAYABLE', fields: ['amount', 'currency', 'date', 'party', 'category', 'dueDate', 'description'] },
  { key: 'receivable', group: 'due', type: 'INCOME', obligation: true, obligationKind: 'RECEIVABLE', fields: ['amount', 'currency', 'date', 'party', 'dueDate', 'description'] },

  { key: 'transfer', group: 'transfer', type: 'TRANSFER', fields: ['amount', 'currency', 'date', 'account', 'toAccount', 'description'] },
];

const GROUPS: Group[] = ['in', 'out', 'due', 'transfer'];
const inputCls = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-roast outline-none focus:border-primary focus:bg-card';

export function RecordWizard({
  locale,
  accounts,
  parties,
  categories,
  branches,
  today,
}: {
  locale: string;
  accounts: Opt[];
  parties: Opt[];
  categories: Opt[];
  branches: Opt[];
  today: string;
}) {
  const t = useTranslations('finance');
  const [picked, setPicked] = useState<RecordOption | null>(null);

  if (!picked) {
    return (
      <div className="space-y-5">
        {GROUPS.map((g) => (
          <div key={g} className="space-y-2">
            <h3 className="text-sm font-bold text-roast">{t(`wizard.groups.${g}`)}</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {OPTIONS.filter((o) => o.group === g).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setPicked(o)}
                  className="group flex items-center justify-between gap-2 rounded-[var(--radius)] border border-border/80 bg-card p-3 text-start shadow-[0_1px_0_rgba(83,45,31,0.05)] hover:border-primary/45 hover:bg-linen/25"
                >
                  <span>
                    <span className="block text-sm font-semibold text-roast">{t(`wizard.options.${o.key}.label`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(`wizard.options.${o.key}.hint`)}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180 group-hover:text-primary" />
                </button>
              ))}
            </div>
          </div>
        ))}
        <Link href="/finance/ledger/new" className="inline-block text-sm font-medium text-primary hover:underline">
          {t('wizard.custom')}
        </Link>
      </div>
    );
  }

  return <RecordForm option={picked} onBack={() => setPicked(null)} locale={locale} accounts={accounts} parties={parties} categories={categories} branches={branches} today={today} />;
}

function RecordForm({
  option,
  onBack,
  locale,
  accounts,
  parties,
  categories,
  branches,
  today,
}: {
  option: RecordOption;
  onBack: () => void;
  locale: string;
  accounts: Opt[];
  parties: Opt[];
  categories: Opt[];
  branches: Opt[];
  today: string;
}) {
  const t = useTranslations('finance');
  const [state, action, pending] = useActionState<ActionState, FormData>(createEntry, undefined);
  const [currency, setCurrency] = useState('IQD');

  const field = (k: FieldKey) => {
    switch (k) {
      case 'amount':
        return wrap('amount', t('f.amount'), <input name="amount" type="number" step="1" required className={inputCls} />);
      case 'currency':
        return wrap(
          'currency',
          t('f.currency'),
          <div className="flex gap-2">
            <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls}>
              <option value="IQD">IQD</option>
              <option value="USD">USD</option>
            </select>
            {currency === 'USD' ? <input name="rate" type="number" step="1" placeholder={t('f.ratePlaceholder')} className={inputCls} /> : null}
          </div>,
        );
      case 'date':
        return wrap('date', t('f.date'), <input name="date" type="date" required defaultValue={today} className={inputCls} />);
      case 'dueDate':
        return wrap('dueDate', t('f.dueDate'), <input name="dueDate" type="date" defaultValue={today} className={inputCls} />);
      case 'account':
        return wrap('account', t('f.account'), select('accountId', accounts, true));
      case 'toAccount':
        return wrap('toAccount', t('f.toAccount'), select('toAccountId', accounts, true));
      case 'party':
        return wrap('party', t('f.party'), select('partyId', parties, false));
      case 'category':
        return wrap('category', t('f.category'), select('categoryType', categories, false));
      case 'branch':
        return wrap('branch', t('f.branch'), select('branchId', branches, false));
      case 'reference':
        return wrap('reference', t('f.reference'), <input name="reference" type="text" className={inputCls} />);
      case 'attachmentUrl':
        return wrap('attachmentUrl', t('f.attachmentUrl'), <input name="attachmentUrl" type="text" className={inputCls} />);
      case 'description':
        return wrap('description', t('f.description'), <input name="description" type="text" className={inputCls} />);
    }
  };

  return (
    <form action={action} className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-roast">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t('wizard.back')}
      </button>

      <div className="rounded-[var(--radius)] border border-border/80 bg-card p-4 shadow-[0_1px_0_rgba(83,45,31,0.05)]">
        <h3 className="mb-1 text-sm font-semibold text-roast">{t(`wizard.options.${option.key}.label`)}</h3>
        <p className="mb-4 text-xs text-muted-foreground">{t(`wizard.options.${option.key}.hint`)}</p>

        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="type" value={option.type} />
        <input type="hidden" name="obligation" value={option.obligation ? 'yes' : 'no'} />
        {option.obligationKind ? <input type="hidden" name="obligationKind" value={option.obligationKind} /> : null}

        <div className="grid gap-3 sm:grid-cols-2">{option.fields.map((k) => <div key={k}>{field(k)}</div>)}</div>

        {option.note === 'settle' ? <p className="mt-3 text-xs text-muted-foreground">{t('wizard.settleNote')}</p> : null}
        {state?.error ? (
          <p className="mt-3 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
            {t('wizard.error')}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-amber/90 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {t('wizard.save')}
        </button>
      </div>
    </form>
  );

  function wrap(key: string, label: string, control: React.ReactNode) {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        {control}
        {key in FIELD_HELP ? <span className="text-xs text-muted-foreground">{t(FIELD_HELP[key as FieldKey])}</span> : null}
      </label>
    );
  }
  function select(name: string, opts: Opt[], required: boolean) {
    return (
      <select name={name} required={required} className={inputCls}>
        {!required ? <option value="">—</option> : null}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }
}
