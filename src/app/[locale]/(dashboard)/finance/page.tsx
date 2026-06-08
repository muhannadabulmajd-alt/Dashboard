import { getTranslations } from 'next-intl/server';
import {
  Wallet,
  Landmark,
  TrendingDown,
  TrendingUp,
  Clock,
  HandCoins,
  Users,
  BookOpen,
  PieChart,
  Plus,
  ChevronRight,
  Scale,
  type LucideIcon,
} from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney, convertToIqd } from '@/lib/money';
import { can } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { accountBalance, financeTotals, type FinanceEntryLike } from '@/lib/metrics/finance';
import { getUsdToIqd } from '@/server/settings';
import { setUsdToIqd } from '@/server/finance/settings';
import { RateEditor } from '@/components/finance/RateEditor';
import { PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BarChartCard, DonutChartCard } from '@/components/charts/Charts';
import { Link } from '@/i18n/navigation';
import type { Currency, ExpenseCategoryType } from '@prisma/client';

type Vals = { cash: number; capitalIn: number; expenses: number; received: number; payable: number; receivable: number };
type ChartEntry = FinanceEntryLike & {
  date: Date;
  categoryType: ExpenseCategoryType | null;
  party: { name: string } | null;
};

type Tone = 'in' | 'out' | 'neutral' | 'warn';
const TONES: Record<Tone, string> = {
  in: 'bg-success-soft text-success',
  out: 'bg-danger-soft text-danger',
  neutral: 'bg-primary/10 text-primary',
  warn: 'bg-warning-soft text-warning',
};

function Kpi({
  label,
  value,
  Icon,
  tone,
  href,
}: {
  label: string;
  value: string;
  Icon: LucideIcon;
  tone: Tone;
  href?: string;
}) {
  const body = (
    <div className="flex h-full items-start gap-3 rounded-[var(--radius)] border bg-card p-4 transition-colors hover:border-primary/40">
      <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', TONES[tone])}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-1 truncate text-xl font-bold tabular-nums text-foreground" title={value}>
          {value}
        </div>
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export default async function FinancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'view:finance');
  const t = await getTranslations('finance');
  const canManage = can(user.role, 'manage:finance');

  const [accounts, entriesRaw] = await Promise.all([
    prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }),
    prisma.financeEntry.findMany({
      select: {
        id: true, type: true, amount: true, currency: true, obligation: true,
        obligationKind: true, accountId: true, toAccountId: true, settlesId: true,
        date: true, categoryType: true, party: { select: { name: true } },
      },
    }),
  ]);
  const entries = entriesRaw as ChartEntry[];

  const currencies = Array.from(new Set([...accounts.map((a) => a.currency), ...entries.map((e) => e.currency)]));
  if (currencies.length === 0) currencies.push('IQD');

  const rate = await getUsdToIqd();
  const byCur = currencies.map((cur) => {
    const ce = entries.filter((e) => e.currency === cur);
    const ca = accounts.filter((a) => a.currency === cur);
    const tot = financeTotals(ce);
    const cash = ca.reduce((s, a) => s + accountBalance(a, ce), 0);
    const vals: Vals = {
      cash,
      capitalIn: tot.capitalIn,
      expenses: tot.expenses,
      received: tot.received,
      payable: tot.outstandingPayable,
      receivable: tot.outstandingReceivable,
    };
    return { cur, ce, ca, vals };
  });
  const combined: Vals = byCur.reduce<Vals>(
    (acc, x) => {
      (Object.keys(acc) as (keyof Vals)[]).forEach((k) => {
        acc[k] += convertToIqd(x.vals[k], x.cur, rate);
      });
      return acc;
    },
    { cash: 0, capitalIn: 0, expenses: 0, received: 0, payable: 0, receivable: 0 },
  );
  const showCombined = currencies.length > 1;

  // Charts (all converted to IQD at the rate).
  const iqd = (e: ChartEntry) => convertToIqd(e.amount, e.currency, rate);
  const isSpend = (e: ChartEntry) => e.type === 'EXPENSE' || e.type === 'PURCHASE';
  const spendByMonth = (() => {
    const map = new Map<string, number>();
    for (const e of entries.filter(isSpend)) {
      const k = e.date.toISOString().slice(0, 7);
      map.set(k, (map.get(k) ?? 0) + iqd(e));
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value }));
  })();
  const spendByCategory = (() => {
    const map = new Map<string, number>();
    for (const e of entries.filter(isSpend)) {
      const key = e.categoryType ? enumLabel(e.categoryType, locale) : '—';
      map.set(key, (map.get(key) ?? 0) + iqd(e));
    }
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  })();
  const topParties = (() => {
    const map = new Map<string, number>();
    for (const e of entries.filter((x) => isSpend(x) || x.type === 'PAYMENT_OUT')) {
      if (!e.party?.name) continue;
      map.set(e.party.name, (map.get(e.party.name) ?? 0) + iqd(e));
    }
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  })();

  const tiles = (v: Vals): { label: string; value: number; Icon: LucideIcon; tone: Tone; href: string }[] => [
    { label: t('cashOnHand'), value: v.cash, Icon: Wallet, tone: 'neutral', href: '/finance/accounts' },
    { label: t('capital'), value: v.capitalIn, Icon: Landmark, tone: 'in', href: '/finance/shareholders' },
    { label: t('spent'), value: v.expenses, Icon: TrendingDown, tone: 'out', href: '/finance/ledger' },
    { label: t('received'), value: v.received, Icon: TrendingUp, tone: 'in', href: '/finance/ledger' },
    { label: t('payables'), value: v.payable, Icon: Clock, tone: 'warn', href: '/finance/dues' },
    { label: t('receivables'), value: v.receivable, Icon: HandCoins, tone: 'in', href: '/finance/dues' },
  ];
  const KpiRow = ({ v, cur }: { v: Vals; cur: string }) => (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {tiles(v).map((tile) => (
        <Kpi key={tile.label} label={tile.label} value={formatMoney(tile.value, cur as Currency, locale)} Icon={tile.Icon} tone={tile.tone} href={tile.href} />
      ))}
    </div>
  );

  const accCols: Column[] = [
    { label: t('f.name') },
    { label: t('f.type') },
    { label: t('f.balance'), align: 'end' },
  ];

  const cards: { href: string; key: string; Icon: LucideIcon }[] = [
    { href: '/finance/ledger', key: 'ledger', Icon: BookOpen },
    { href: '/finance/dues', key: 'dues', Icon: Clock },
    { href: '/finance/shareholders', key: 'shareholders', Icon: PieChart },
    { href: '/balance-sheet', key: 'balanceSheet', Icon: Scale },
    { href: '/finance/accounts', key: 'accounts', Icon: Wallet },
    { href: '/finance/parties', key: 'parties', Icon: Users },
  ];

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        {canManage ? (
          <Link
            href="/finance/ledger/new"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
          >
            <Plus className="size-4" />
            {t('recordEntry')}
          </Link>
        ) : null}
      </div>

      {canManage ? (
        <RateEditor action={setUsdToIqd} locale={locale} rate={rate} label={t('rate')} apply={t('apply')} />
      ) : null}

      {showCombined ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold tracking-wide text-primary">
              {t('allInIqd')}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <KpiRow v={combined} cur="IQD" />
        </section>
      ) : null}

      {byCur.map(({ cur, ce, ca, vals }) => (
        <section key={cur} className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md border bg-card px-2 py-0.5 text-xs font-bold tracking-wide text-muted-foreground">
              {cur}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <KpiRow v={vals} cur={cur} />
          {ca.length ? (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">{t('byAccount')}</div>
              <DataTable
                columns={accCols}
                rows={ca.map((a) => [
                  a.name,
                  enumLabel(a.type, locale),
                  formatMoney(accountBalance(a, ce), cur, locale),
                ])}
                emptyLabel="—"
              />
            </div>
          ) : null}
        </section>
      ))}

      {spendByCategory.length ? (
        <section className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <BarChartCard title={t('spendByMonth')} data={spendByMonth} locale={locale} valueKind="iqd" />
            <DonutChartCard title={t('spendByCategory')} data={spendByCategory} locale={locale} valueKind="iqd" />
          </div>
          {topParties.length ? (
            <BarChartCard title={t('topSuppliers')} data={topParties} locale={locale} valueKind="iqd" horizontal />
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ href, key, Icon }) => (
          <Link
            key={key}
            href={href}
            className="group flex items-center gap-3 rounded-[var(--radius)] border bg-card p-4 hover:border-primary hover:shadow-sm"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">{t(key)}</div>
              <div className="truncate text-xs text-muted-foreground">{t(`entityHints.${key}`)}</div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180 group-hover:text-primary" />
          </Link>
        ))}
      </div>
    </>
  );
}
