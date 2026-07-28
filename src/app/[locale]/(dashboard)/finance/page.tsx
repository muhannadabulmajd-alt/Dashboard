import {
  AlertTriangle,
  BadgeDollarSign,
  Clock,
  HandCoins,
  Package,
  Plus,
  TrendingDown,
  UsersRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { formatMoney, convertToIqd } from '@/lib/money';
import { can } from '@/lib/rbac';
import { enumLabel } from '@/lib/enums';
import { serializeFilters } from '@/lib/filters';
import { financeTotals, netCash, type FinanceEntryLike } from '@/lib/metrics/finance';
import { getUsdToIqd } from '@/server/settings';
import { setUsdToIqd } from '@/server/finance/settings';
import { getSpendRows, getSpendTotals, spendByCategory, spendByMonth, spendByParty } from '@/server/finance/spend';
import { getOrders, getOrderLines } from '@/server/db/repositories/sales.repo';
import { getExpenses, getPaymentProcessingCosts } from '@/server/db/repositories/finance.repo';
import * as M from '@/lib/metrics';
import { RateEditor } from '@/components/finance/RateEditor';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui/primitives';
import { KpiCard } from '@/components/kpi/KpiCard';
import { BarChartCard, DonutChartCard } from '@/components/charts/Charts';
import { Link } from '@/i18n/navigation';

type ChartEntry = FinanceEntryLike & {
  date: Date;
  dueDate: Date | null;
};

const ALERT_TONES = {
  danger: 'border-danger/40 bg-danger-soft text-danger',
  warning: 'border-warning/40 bg-warning-soft text-warning',
} as const;

type FinancialAlert = { title: string; body: string; href: string; tone: keyof typeof ALERT_TONES };
type WalletIssue = { count: number; grossAmount: number };

function parseWalletIssue(value: string | undefined): WalletIssue | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<WalletIssue>;
    return typeof parsed.count === 'number' && typeof parsed.grossAmount === 'number'
      ? { count: parsed.count, grossAmount: parsed.grossAmount }
      : null;
  } catch {
    return null;
  }
}

function filteredHref(base: string, filters: Parameters<typeof serializeFilters>[0], extra?: Record<string, string | undefined>) {
  const sp = serializeFilters(filters);
  for (const [key, value] of Object.entries(extra ?? {})) if (value) sp.set(key, value);
  const query = sp.toString();
  return query ? `${base}?${query}` : base;
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

  const branchWhere = scope.branchId
    ? { branchId: scope.branchId }
    : filters.branchId?.length
      ? { branchId: { in: filters.branchId } }
      : {};

  const [
    accounts,
    entriesRaw,
    rate,
    spendTotals,
    allSpendRows,
    opexRows,
    orders,
    orderLines,
    operatingExpenses,
    paymentProcessingCosts,
    walletIssueSetting,
  ] = await Promise.all([
    prisma.financeAccount.findMany({ where: { isActive: true, ...branchWhere }, orderBy: { createdAt: 'asc' } }),
    prisma.financeEntry.findMany({
      where: { archivedAt: null, reversedAt: null, reversalOfId: null, date: { lte: range.end }, ...branchWhere },
      select: {
        id: true,
        type: true,
        amount: true,
        currency: true,
        obligation: true,
        obligationKind: true,
        accountId: true,
        toAccountId: true,
        settlesId: true,
        archivedAt: true,
        reversedAt: true,
        reversalOfId: true,
        date: true,
        dueDate: true,
      },
    }),
    getUsdToIqd(),
    getSpendTotals(filters, scope, range),
    getSpendRows('all', filters, scope, range),
    getSpendRows('opex', filters, scope, range),
    getOrders(filters, scope, range),
    getOrderLines(filters, scope, range),
    getExpenses(filters, scope, range),
    getPaymentProcessingCosts(filters, scope, range),
    prisma.setting.findUnique({
      where: { key: 'wayl_wallet_unmatched_sales' },
      select: { value: true },
    }),
  ]);
  const pnl = M.buildPnlSnapshot(orders, orderLines, operatingExpenses, {
    paymentProcessingCosts,
  });
  const averageOrderValue = orders.length ? Math.round(pnl.netSales / orders.length) : 0;
  const walletIssue = parseWalletIssue(walletIssueSetting?.value);
  const entries = entriesRaw as ChartEntry[];

  const currencies = Array.from(new Set([...accounts.map((a) => a.currency), ...entries.map((e) => e.currency)]));
  if (!currencies.length) currencies.push('IQD');

  const byCur = currencies.map((cur) => {
    const ce = entries.filter((e) => e.currency === cur);
    const ca = accounts.filter((a) => a.currency === cur);
    const totals = financeTotals(ce);
    return {
      cur,
      totals,
      cash: netCash(ca, ce),
    };
  });
  const combined = byCur.reduce(
    (acc, row) => {
      acc.cash += convertToIqd(row.cash, row.cur, rate);
      acc.payable += convertToIqd(row.totals.outstandingPayable, row.cur, rate);
      acc.receivable += convertToIqd(row.totals.outstandingReceivable, row.cur, rate);
      return acc;
    },
    { cash: 0, payable: 0, receivable: 0 },
  );

  const iqd = (entry: ChartEntry) => convertToIqd(entry.amount, entry.currency, rate);
  const paidByObligation = new Map<string, number>();
  for (const entry of entries) {
    if (entry.settlesId) paidByObligation.set(entry.settlesId, (paidByObligation.get(entry.settlesId) ?? 0) + iqd(entry));
  }

  const now = new Date();
  const overdue = entries.reduce(
    (acc, entry) => {
      if (!entry.obligation || !entry.obligationKind || !entry.dueDate || entry.dueDate >= now) return acc;
      const outstanding = Math.max(0, iqd(entry) - (paidByObligation.get(entry.id) ?? 0));
      if (entry.obligationKind === 'PAYABLE') acc.payables += outstanding;
      else acc.receivables += outstanding;
      return acc;
    },
    { payables: 0, receivables: 0 },
  );

  const largeOpex = opexRows
    .map((row) => row.amount)
    .filter((amount) => amount >= 1_000_000)
    .sort((a, b) => b - a);
  const openPayables = entries
    .filter((entry) => entry.obligation && entry.obligationKind === 'PAYABLE')
    .map((entry) => Math.max(0, iqd(entry) - (paidByObligation.get(entry.id) ?? 0)))
    .filter((amount) => amount > 0);
  const financialAlerts: FinancialAlert[] = [
    ...(walletIssue?.count
      ? [{
          title: t('alerts.walletUnmatched.title'),
          body: t('alerts.walletUnmatched.body', {
            count: walletIssue.count,
            amount: formatMoney(walletIssue.grossAmount, 'IQD', locale),
          }),
          href: '/finance/ledger',
          tone: 'warning' as const,
        }]
      : []),
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
    ...(openPayables.length
      ? [{
          title: t('alerts.unpaidSupplierInvoices.title'),
          body: t('alerts.unpaidSupplierInvoices.body', { count: openPayables.length }),
          href: '/finance/dues',
          tone: 'warning' as const,
        }]
      : []),
    ...(largeOpex.length
      ? [{
          title: t('alerts.largeExpense.title'),
          body: t('alerts.largeExpense.body', {
            amount: formatMoney(largeOpex[0], 'IQD', locale),
            count: Math.min(largeOpex.length, 3),
          }),
          href: filteredHref('/finance/spend', filters, { bucket: 'opex' }),
          tone: 'warning' as const,
        }]
      : []),
  ];

  const spendBase = '/finance/spend';
  const monthChart = spendByMonth(allSpendRows).map((row) => ({
    label: row.key,
    value: row.amount,
    href: filteredHref(spendBase, filters, { bucket: 'all', month: row.key }),
  }));
  const categoryChart = spendByCategory(allSpendRows).map((row) => ({
    label: enumLabel(row.key, locale),
    value: row.amount,
    href: filteredHref(spendBase, filters, { bucket: 'all', category: row.key }),
  }));
  const partyChart = spendByParty(allSpendRows).slice(0, 8).map((row) => ({
    label: row.key,
    value: row.amount,
    href: filteredHref(spendBase, filters, { bucket: 'all', party: row.key }),
  }));

  const cards: Array<{
    label: string;
    value: number;
    icon: LucideIcon;
    href: string;
    tone: 'accent' | 'success' | 'warning' | 'danger';
    emphasis?: boolean;
  }> = [
    {
      label: t('salesEarned'),
      value: pnl.netSales,
      icon: BadgeDollarSign,
      href: '/pnl',
      tone: 'success' as const,
      emphasis: true,
    },
    {
      label: t('totalSpent'),
      value: spendTotals.totalSpent,
      icon: TrendingDown,
      href: filteredHref(spendBase, filters, { bucket: 'all' }),
      tone: 'danger' as const,
    },
    {
      label: t('totalAvailable'),
      value: combined.cash,
      icon: Wallet,
      href: '/finance/accounts',
      tone: combined.cash >= 0 ? 'success' as const : 'danger' as const,
    },
    {
      label: t('operatingProfit'),
      value: pnl.operatingProfit,
      icon: HandCoins,
      href: '/pnl',
      tone: pnl.operatingProfit >= 0 ? 'success' as const : 'danger' as const,
    },
    { label: t('receivables'), value: combined.receivable, icon: HandCoins, href: '/finance/dues', tone: 'accent' as const },
    { label: t('payables'), value: combined.payable, icon: Clock, href: '/finance/dues', tone: 'warning' as const },
  ];
  const insightCards: Array<{ label: string; value: number; sub: string; href: string }> = [
    {
      label: t('cogs'),
      value: pnl.cogs,
      sub: t('explain.cogs'),
      href: filteredHref(spendBase, filters, { bucket: 'cogs' }),
    },
    {
      label: t('grossProfit'),
      value: pnl.grossProfit,
      sub: `${t('explain.grossProfit')} · ${t('marginValue', { value: `${(pnl.grossMarginPct * 100).toFixed(1)}%` })}`,
      href: '/pnl',
    },
    {
      label: t('contributionProfit'),
      value: pnl.contributionProfit,
      sub: t('explain.contributionProfit'),
      href: '/pnl',
    },
    {
      label: t('opex'),
      value: spendTotals.opex,
      sub: t('explain.opex'),
      href: filteredHref(spendBase, filters, { bucket: 'opex' }),
    },
    {
      label: t('capex'),
      value: spendTotals.capex,
      sub: t('explain.capex'),
      href: filteredHref(spendBase, filters, { bucket: 'capex' }),
    },
    {
      label: t('inventoryBought'),
      value: spendTotals.inventory,
      sub: t('explain.inventory'),
      href: filteredHref(spendBase, filters, { bucket: 'inventory' }),
    },
    {
      label: t('directSellingCosts'),
      value: spendTotals.direct,
      sub: t('explain.directCosts'),
      href: filteredHref(spendBase, filters, { bucket: 'direct' }),
    },
    {
      label: t('averageOrderValue'),
      value: averageOrderValue,
      sub: t('explain.aov'),
      href: '/sales',
    },
  ];
  const controlLinks = [
    {
      label: t('openLedger'),
      hint: t('ledgerControlHint'),
      href: '/finance/ledger',
      icon: Package,
    },
    ...(canManage
      ? [{
          label: t('recordEntry'),
          hint: t('addRecordHint'),
          href: '/finance/ledger/new',
          icon: Plus,
        }]
      : []),
    {
      label: t('dues'),
      hint: t('duesControlHint'),
      href: '/finance/dues',
      icon: Clock,
    },
    {
      label: t('accounts'),
      hint: t('accountsControlHint'),
      href: '/finance/accounts',
      icon: Wallet,
    },
    {
      label: t('parties'),
      hint: t('partiesControlHint'),
      href: '/finance/parties',
      icon: UsersRound,
    },
    {
      label: t('shareholders'),
      hint: t('shareholdersControlHint'),
      href: '/finance/shareholders',
      icon: HandCoins,
    },
    {
      label: t('financeSpend'),
      hint: t('spendControlHint'),
      href: filteredHref(spendBase, filters, { bucket: 'all' }),
      icon: TrendingDown,
    },
    {
      label: t('balanceSheet'),
      hint: t('balanceSheetControlHint'),
      href: '/balance-sheet',
      icon: Package,
    },
  ];

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title={t('title')} subtitle={t('subtitle')} eyebrow={t('commandCenter')} />
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Link
            href="/finance/shareholders"
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 py-2 text-sm font-semibold text-roast hover:bg-linen/45"
          >
            <UsersRound className="size-4" />
            {t('shareholders')}
          </Link>
          {canManage ? (
            <Link
              href="/finance/ledger/new"
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-amber/90"
            >
              <Plus className="size-4" />
              {t('recordEntry')}
            </Link>
          ) : null}
        </div>
      </div>

      {canManage ? <RateEditor action={setUsdToIqd} locale={locale} rate={rate} label={t('rate')} apply={t('apply')} /> : null}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {cards.map((card) => (
          <KpiCard
            key={card.label}
            label={card.label}
            value={formatMoney(card.value, 'IQD', locale)}
            icon={card.icon}
            tone={card.tone}
            href={card.href}
            emphasis={card.emphasis}
            locale={locale}
          />
        ))}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-roast">{t('understandNumbers')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('understandNumbersHint')}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {insightCards.map((card) => (
            <KpiCard
              key={card.label}
              label={card.label}
              value={formatMoney(card.value, 'IQD', locale)}
              sub={card.sub}
              href={card.href}
              locale={locale}
            />
          ))}
        </div>
      </section>

      <section className="space-y-2 rounded-[var(--radius)] border bg-card p-3">
        <div>
          <h2 className="text-sm font-bold text-roast">{t('financeControlTitle')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('financeControlSubtitle')}</p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {controlLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.hint}
                className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-border/75 bg-background px-3 py-2 text-sm font-semibold text-roast hover:border-primary/45 hover:bg-linen/35"
              >
                <Icon className="size-4 text-primary" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </section>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            <CardTitle>{t('financialAlerts')}</CardTitle>
          </div>
          <Badge variant={financialAlerts.length ? 'warning' : 'success'}>
            {financialAlerts.length ? financialAlerts.length : t('alertsClearShort')}
          </Badge>
        </CardHeader>
        <CardContent>
          {financialAlerts.length ? (
            <div className="grid gap-2 md:grid-cols-3">
              {financialAlerts.slice(0, 3).map((alert) => (
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
            <div className="rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm font-semibold text-success">
              {t('alertsClear')}
            </div>
          )}
        </CardContent>
      </Card>

      {allSpendRows.length ? (
        <section className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <BarChartCard title={t('spendByMonth')} data={monthChart} locale={locale} valueKind="iqd" />
            <DonutChartCard title={t('spendByCategory')} data={categoryChart} locale={locale} valueKind="iqd" />
          </div>
          {partyChart.length ? (
            <BarChartCard title={t('topSuppliers')} data={partyChart} locale={locale} valueKind="iqd" horizontal />
          ) : null}
        </section>
      ) : (
        <div className="rounded-[var(--radius)] border border-dashed border-amber/25 bg-linen/20 p-6 text-center text-sm text-muted-foreground">
          {t('noSpend')}
        </div>
      )}
    </>
  );
}
