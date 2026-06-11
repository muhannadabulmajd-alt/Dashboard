import { getTranslations } from 'next-intl/server';
import {
  Wallet,
  Landmark,
  Banknote,
  TrendingDown,
  TrendingUp,
  Clock,
  HandCoins,
  Package,
  Users,
  BookOpen,
  FileBarChart2,
  PieChart,
  Plus,
  ChevronRight,
  Scale,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  History,
  type LucideIcon,
} from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney, convertToIqd, type AppLocale } from '@/lib/money';
import { can } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { accountBalance, netCash, unassignedCash, financeTotals, type FinanceEntryLike } from '@/lib/metrics/finance';
import { cogs, grossMargin, netSales } from '@/lib/metrics';
import { getUsdToIqd } from '@/server/settings';
import { getOrders, getOrderLines } from '@/server/db/repositories/sales.repo';
import { setUsdToIqd } from '@/server/finance/settings';
import { RateEditor } from '@/components/finance/RateEditor';
import { PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BarChartCard, DonutChartCard } from '@/components/charts/Charts';
import { SectionGuide } from '@/components/records/SectionGuide';
import { Link } from '@/i18n/navigation';
import type { Currency, ExpenseCategoryType } from '@prisma/client';

type Vals = {
  cash: number;
  capitalIn: number;
  expenses: number;
  received: number;
  cashIn: number;
  cashOut: number;
  payable: number;
  receivable: number;
};
type ChartEntry = FinanceEntryLike & {
  date: Date;
  dueDate: Date | null;
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
const ALERT_TONES = {
  danger: 'border-danger/40 bg-danger-soft text-danger',
  warning: 'border-warning/40 bg-warning-soft text-warning',
} as const;
type Tile = { label: string; value: number; Icon: LucideIcon; tone: Tone; href?: string };
type FinancialAlert = { title: string; body: string; href: string; tone: keyof typeof ALERT_TONES };

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

function KpiGrid({ tiles, currency, locale }: { tiles: Tile[]; currency: Currency; locale: AppLocale }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {tiles.map((tile) => (
        <Kpi
          key={tile.label}
          label={tile.label}
          value={formatMoney(tile.value, currency, locale)}
          Icon={tile.Icon}
          tone={tile.tone}
          href={tile.href}
        />
      ))}
    </div>
  );
}

export default async function FinancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user, filters, scope, range } = await getPageContext(params, searchParams, 'view:finance');
  const t = await getTranslations('finance');
  const canManage = can(user.role, 'manage:finance');

  const [accounts, entriesRaw, orders, lines, inventoryItems] = await Promise.all([
    prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }),
    prisma.financeEntry.findMany({
      where: { reversedAt: null, reversalOfId: null },
      select: {
        id: true, type: true, amount: true, currency: true, obligation: true,
        obligationKind: true, accountId: true, toAccountId: true, settlesId: true,
        date: true, dueDate: true, categoryType: true, party: { select: { name: true } },
      },
    }),
    getOrders(filters, scope, range),
    getOrderLines(filters, scope, range),
    prisma.inventoryItem.findMany({
      where: scope.branchId ? { branchId: scope.branchId } : {},
      select: {
        unitCost: true,
        movements: { select: { quantity: true } },
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
    const cash = netCash(ca, ce);
    const vals: Vals = {
      cash,
      capitalIn: tot.capitalIn,
      expenses: tot.expenses,
      received: tot.received,
      cashIn: tot.cashIn,
      cashOut: tot.cashOut,
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
    { cash: 0, capitalIn: 0, expenses: 0, received: 0, cashIn: 0, cashOut: 0, payable: 0, receivable: 0 },
  );
  const showCombined = currencies.length > 1;

  const iqd = (e: ChartEntry) => convertToIqd(e.amount, e.currency, rate);
  const accountBalanceIqd = (account: (typeof accounts)[number]) =>
    convertToIqd(
      accountBalance(account, entries.filter((e) => e.currency === account.currency)),
      account.currency,
      rate,
    );
  const cashAccounts = accounts.filter((a) => a.type === 'CASH').reduce((s, a) => s + accountBalanceIqd(a), 0);
  const bankAccounts = accounts.filter((a) => a.type !== 'CASH').reduce((s, a) => s + accountBalanceIqd(a), 0);
  const totalAvailable = combined.cash;
  const revenue = netSales(orders);
  const costOfGoods = cogs(lines);
  const gross = grossMargin(revenue, costOfGoods);
  const operatingExpenses = entries
    .filter((e) => e.type === 'EXPENSE')
    .reduce((s, e) => s + iqd(e), 0);
  const netProfit = gross.amount - operatingExpenses;
  const inventoryValue = inventoryItems.reduce(
    (s, item) => s + (item.unitCost ?? 0) * item.movements.reduce((sum, m) => sum + m.quantity, 0),
    0,
  );
  const netCashMovement = combined.cashIn - combined.cashOut;
  const now = new Date();
  const paidByObligation = new Map<string, number>();
  for (const e of entries) {
    if (e.settlesId) paidByObligation.set(e.settlesId, (paidByObligation.get(e.settlesId) ?? 0) + iqd(e));
  }
  const overdue = entries.reduce(
    (acc, e) => {
      if (!e.obligation || !e.obligationKind || !e.dueDate || e.dueDate >= now) return acc;
      const outstanding = Math.max(0, iqd(e) - (paidByObligation.get(e.id) ?? 0));
      if (e.obligationKind === 'PAYABLE') acc.payables += outstanding;
      else acc.receivables += outstanding;
      return acc;
    },
    { payables: 0, receivables: 0 },
  );
  const openPayables = entries
    .filter((e) => e.obligation && e.obligationKind === 'PAYABLE')
    .map((e) => Math.max(0, iqd(e) - (paidByObligation.get(e.id) ?? 0)))
    .filter((amount) => amount > 0);
  const largeExpenses = entries
    .filter((e) => (e.type === 'EXPENSE' || e.type === 'PURCHASE') && iqd(e) >= 1_000_000)
    .sort((a, b) => iqd(b) - iqd(a))
    .slice(0, 3);
  const largestExpense = largeExpenses[0] ? iqd(largeExpenses[0]) : 0;
  const financialAlerts: FinancialAlert[] = [
    ...(overdue.payables > 0
      ? [{
          title: t('alerts.overduePayables.title'),
          body: t('alerts.overduePayables.body', { amount: formatMoney(overdue.payables, 'IQD', locale) }),
          href: '/finance/dues',
          tone: 'danger' as const,
        }]
      : []),
    ...(overdue.receivables > 0
      ? [{
          title: t('alerts.overdueReceivables.title'),
          body: t('alerts.overdueReceivables.body', { amount: formatMoney(overdue.receivables, 'IQD', locale) }),
          href: '/finance/dues',
          tone: 'warning' as const,
        }]
      : []),
    ...(combined.cash < 0 || (combined.payable > 0 && combined.cash < combined.payable)
      ? [{
          title: t('alerts.lowCash.title'),
          body: t('alerts.lowCash.body', {
            cash: formatMoney(combined.cash, 'IQD', locale),
            payables: formatMoney(combined.payable, 'IQD', locale),
          }),
          href: '/finance/accounts',
          tone: 'danger' as const,
        }]
      : []),
    ...(gross.amount < 0 || gross.pct < 0
      ? [{
          title: t('alerts.negativeMargin.title'),
          body: t('alerts.negativeMargin.body', { amount: formatMoney(gross.amount, 'IQD', locale) }),
          href: '/pnl',
          tone: 'danger' as const,
        }]
      : []),
    ...(openPayables.length > 0
      ? [{
          title: t('alerts.unpaidSupplierInvoices.title'),
          body: t('alerts.unpaidSupplierInvoices.body', { count: openPayables.length }),
          href: '/finance/dues',
          tone: 'warning' as const,
        }]
      : []),
    ...(largeExpenses.length > 0
      ? [{
          title: t('alerts.largeExpense.title'),
          body: t('alerts.largeExpense.body', {
            amount: formatMoney(largestExpense, 'IQD', locale),
            count: largeExpenses.length,
          }),
          href: '/finance/ledger',
          tone: 'warning' as const,
        }]
      : []),
  ];

  // Charts (all converted to IQD at the rate).
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

  const tiles = (v: Vals): Tile[] => [
    { label: t('cashOnHand'), value: v.cash, Icon: Wallet, tone: 'neutral', href: '/finance/accounts' },
    { label: t('capital'), value: v.capitalIn, Icon: Landmark, tone: 'in', href: '/finance/shareholders' },
    { label: t('spent'), value: v.expenses, Icon: TrendingDown, tone: 'out', href: '/finance/ledger' },
    { label: t('received'), value: v.received, Icon: TrendingUp, tone: 'in', href: '/finance/ledger' },
    { label: t('payables'), value: v.payable, Icon: Clock, tone: 'warn', href: '/finance/dues' },
    { label: t('receivables'), value: v.receivable, Icon: HandCoins, tone: 'in', href: '/finance/dues' },
  ];
  const commandCards: Tile[] = [
    { label: t('cashOnHand'), value: cashAccounts, Icon: Wallet, tone: 'neutral', href: '/finance/accounts' },
    { label: t('bankBalance'), value: bankAccounts, Icon: Banknote, tone: 'neutral', href: '/finance/accounts' },
    { label: t('totalAvailable'), value: totalAvailable, Icon: Wallet, tone: 'in', href: '/finance/accounts' },
    { label: t('totalRevenue'), value: revenue, Icon: TrendingUp, tone: 'in', href: '/sales' },
    { label: t('totalExpenses'), value: operatingExpenses, Icon: TrendingDown, tone: 'out', href: '/finance/ledger' },
    { label: t('netProfit'), value: netProfit, Icon: PieChart, tone: netProfit >= 0 ? 'in' : 'out', href: '/pnl' },
    { label: t('grossProfit'), value: gross.amount, Icon: PieChart, tone: gross.amount >= 0 ? 'in' : 'out', href: '/pnl' },
    { label: t('cogs'), value: costOfGoods, Icon: Package, tone: 'out', href: '/pnl' },
    { label: t('payables'), value: combined.payable, Icon: Clock, tone: 'warn', href: '/finance/dues' },
    { label: t('receivables'), value: combined.receivable, Icon: HandCoins, tone: 'in', href: '/finance/dues' },
    { label: t('capital'), value: combined.capitalIn, Icon: Landmark, tone: 'in', href: '/finance/shareholders' },
    { label: t('inventoryValue'), value: inventoryValue, Icon: Package, tone: 'neutral', href: '/inventory' },
    { label: t('netCashMovement'), value: netCashMovement, Icon: netCashMovement >= 0 ? TrendingUp : TrendingDown, tone: netCashMovement >= 0 ? 'in' : 'out' },
    { label: t('overdueReceivables'), value: overdue.receivables, Icon: HandCoins, tone: overdue.receivables > 0 ? 'warn' : 'in', href: '/finance/dues' },
    { label: t('overduePayables'), value: overdue.payables, Icon: Clock, tone: overdue.payables > 0 ? 'warn' : 'neutral', href: '/finance/dues' },
  ];

  const accCols: Column[] = [
    { label: t('f.name') },
    { label: t('f.type') },
    { label: t('f.balance'), align: 'end' },
  ];

  const cards: { href: string; key: string; Icon: LucideIcon }[] = [
    { href: '/finance/reports', key: 'reports', Icon: FileBarChart2 },
    { href: '/finance/ledger', key: 'ledger', Icon: BookOpen },
    { href: '/finance/dues', key: 'dues', Icon: Clock },
    { href: '/finance/shareholders', key: 'shareholders', Icon: PieChart },
    { href: '/balance-sheet', key: 'balanceSheet', Icon: Scale },
    { href: '/finance/accounts', key: 'accounts', Icon: Wallet },
    { href: '/finance/parties', key: 'parties', Icon: Users },
    { href: '/finance/audit', key: 'auditLog', Icon: History },
  ];
  const permissions = [
    { label: t('permissions.viewDashboard'), allowed: can(user.role, 'view:finance') },
    { label: t('permissions.recordEditReverse'), allowed: canManage },
    { label: t('permissions.viewFinancialReports'), allowed: can(user.role, 'view:financial') },
    { label: t('permissions.exportReports'), allowed: can(user.role, 'export:financial') },
    { label: t('permissions.manageAccountsParties'), allowed: canManage },
    { label: t('permissions.changeExchangeRate'), allowed: canManage },
  ];

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        {canManage ? (
          <Link
            href="/finance/record"
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

      <SectionGuide
        title={t('guide.home.title')}
        intro={t('guide.home.intro')}
        points={t.raw('guide.home.points')}
      />

      <section className="space-y-3 rounded-[var(--radius)] border bg-card p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-warning" />
          <h2 className="text-sm font-semibold text-foreground">{t('financialAlerts')}</h2>
        </div>
        {financialAlerts.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {financialAlerts.map((alert) => (
              <Link
                key={alert.title}
                href={alert.href}
                className={`rounded-lg border p-3 hover:opacity-90 ${ALERT_TONES[alert.tone]}`}
              >
                <div className="text-sm font-semibold">{alert.title}</div>
                <div className="mt-1 text-xs leading-5 opacity-90">{alert.body}</div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
            {t('alertsClear')}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-[var(--radius)] border bg-card p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t('permissionControl')}</h2>
            <p className="text-xs text-muted-foreground">{t('permissionControlHint', { role: enumLabel(user.role, locale) })}</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {permissions.map((permission) => (
            <div key={permission.label} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
              {permission.allowed ? (
                <CheckCircle2 className="size-4 text-success" />
              ) : (
                <XCircle className="size-4 text-muted-foreground" />
              )}
              <span className={permission.allowed ? 'text-foreground' : 'text-muted-foreground'}>{permission.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold tracking-wide text-primary">
            {t('commandCenter')}
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {commandCards.map((card) => (
            <Kpi
              key={card.label}
              label={card.label}
              value={formatMoney(card.value, 'IQD', locale)}
              Icon={card.Icon}
              tone={card.tone}
              href={card.href}
            />
          ))}
        </div>
      </section>

      {showCombined ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold tracking-wide text-primary">
              {t('allInIqd')}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <KpiGrid tiles={tiles(combined)} currency="IQD" locale={locale} />
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
          <KpiGrid tiles={tiles(vals)} currency={cur as Currency} locale={locale} />
          {ca.length || unassignedCash(ce) ? (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">{t('byAccount')}</div>
              <DataTable
                columns={accCols}
                rows={[
                  ...ca.map((a) => [
                    a.name,
                    enumLabel(a.type, locale),
                    formatMoney(accountBalance(a, ce), cur, locale),
                  ]),
                  ...(unassignedCash(ce)
                    ? [[t('unassigned'), '—', formatMoney(unassignedCash(ce), cur, locale)]]
                    : []),
                ]}
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
      ) : (
        <div className="rounded-[var(--radius)] border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          {t('noSpend')}
        </div>
      )}

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
