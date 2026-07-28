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
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/rbac';
import { enumLabel } from '@/lib/enums';
import { serializeFilters } from '@/lib/filters';
import { setUsdToIqd } from '@/server/finance/settings';
import { getSpendRows, getSpendTotals, spendByCategory, spendByMonth, spendByParty } from '@/server/finance/spend';
import { getPaymentFacts, getProfitFacts } from '@/server/finance/facts';
import { RateEditor } from '@/components/finance/RateEditor';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui/primitives';
import { KpiCard } from '@/components/kpi/KpiCard';
import { BarChartCard, DonutChartCard } from '@/components/charts/Charts';
import { Link } from '@/i18n/navigation';

const ALERT_TONES = {
  danger: 'border-danger/40 bg-danger-soft text-danger',
  warning: 'border-warning/40 bg-warning-soft text-warning',
} as const;

type FinancialAlert = { title: string; body: string; href: string; tone: keyof typeof ALERT_TONES };
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

  const [
    paymentFacts,
    spendTotals,
    allSpendRows,
    opexRows,
    profitFacts,
    walletReview,
  ] = await Promise.all([
    getPaymentFacts(filters, scope, range),
    getSpendTotals(filters, scope, range),
    getSpendRows('all', filters, scope, range),
    getSpendRows('operating', filters, scope, range),
    getProfitFacts(filters, scope, range),
    prisma.paymentReconciliationItem.aggregate({
      where: { status: 'NEEDS_ORDER', provider: { externalKey: 'WAYL' } },
      _count: true,
      _sum: { grossAmount: true },
    }),
  ]);
  const { pnl, averageOrderValue } = profitFacts;
  const walletIssue = walletReview._count
    ? { count: walletReview._count, grossAmount: walletReview._sum.grossAmount ?? 0 }
    : null;

  const largeOpex = opexRows
    .map((row) => row.amount)
    .filter((amount) => amount >= 1_000_000)
    .sort((a, b) => b - a);
  const financialAlerts: FinancialAlert[] = [
    ...(walletIssue?.count
      ? [{
          title: t('alerts.walletUnmatched.title'),
          body: t('alerts.walletUnmatched.body', {
            count: walletIssue.count,
            amount: formatMoney(walletIssue.grossAmount, 'IQD', locale),
          }),
          href: '/finance/online-payments',
          tone: 'warning' as const,
        }]
      : []),
    ...(paymentFacts.overdue.payables > 0
      ? [{
          title: t('alerts.overduePayables.title'),
          body: t('alerts.overduePayables.body', { amount: formatMoney(paymentFacts.overdue.payables, 'IQD', locale) }),
          href: '/finance/dues',
          tone: 'danger' as const,
        }]
      : []),
    ...(paymentFacts.overdue.receivables > 0
      ? [{
          title: t('alerts.overdueReceivables.title'),
          body: t('alerts.overdueReceivables.body', { amount: formatMoney(paymentFacts.overdue.receivables, 'IQD', locale) }),
          href: '/finance/dues',
          tone: 'warning' as const,
        }]
      : []),
    ...(paymentFacts.cashAvailable < 0 || (
      paymentFacts.payables > 0 && paymentFacts.cashAvailable < paymentFacts.payables
    )
      ? [{
          title: t('alerts.lowCash.title'),
          body: t('alerts.lowCash.body', {
            cash: formatMoney(paymentFacts.cashAvailable, 'IQD', locale),
            payables: formatMoney(paymentFacts.payables, 'IQD', locale),
          }),
          href: '/finance/accounts',
          tone: 'danger' as const,
        }]
      : []),
    ...(paymentFacts.openPayableCount
      ? [{
          title: t('alerts.unpaidSupplierInvoices.title'),
          body: t('alerts.unpaidSupplierInvoices.body', { count: paymentFacts.openPayableCount }),
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
          href: filteredHref('/finance/spend', filters, { bucket: 'operating' }),
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
      value: paymentFacts.cashAvailable,
      icon: Wallet,
      href: '/finance/accounts',
      tone: paymentFacts.cashAvailable >= 0 ? 'success' as const : 'danger' as const,
    },
    {
      label: t('operatingProfit'),
      value: pnl.operatingProfit,
      icon: HandCoins,
      href: '/pnl',
      tone: pnl.operatingProfit >= 0 ? 'success' as const : 'danger' as const,
    },
    { label: t('receivables'), value: paymentFacts.receivables, icon: HandCoins, href: '/finance/dues', tone: 'accent' as const },
    { label: t('payables'), value: paymentFacts.payables, icon: Clock, href: '/finance/dues', tone: 'warning' as const },
  ];
  const insightCards: Array<{ label: string; value: number; sub: string; href: string }> = [
    {
      label: t('cashReceived'),
      value: paymentFacts.cashReceived,
      sub: t('explain.cashReceived'),
      href: '/finance/accounts',
    },
    {
      label: t('cashPaid'),
      value: paymentFacts.cashPaid,
      sub: t('explain.cashPaid'),
      href: '/finance/accounts',
    },
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
      label: t('operatingSpending'),
      value: spendTotals.operating,
      sub: t('explain.opex'),
      href: filteredHref(spendBase, filters, { bucket: 'operating' }),
    },
    ...(spendTotals.review > 0
      ? [{
          label: t('classificationReview'),
          value: spendTotals.review,
          sub: t('explain.classificationReview'),
          href: filteredHref(spendBase, filters, { bucket: 'review' }),
        }]
      : []),
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
    ...(walletIssue
      ? [{
          label: t('onlinePaymentReview'),
          hint: t('onlinePaymentReviewHint'),
          href: '/finance/online-payments',
          icon: BadgeDollarSign,
        }]
      : []),
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

      {canManage ? <RateEditor action={setUsdToIqd} locale={locale} rate={paymentFacts.rate} label={t('rate')} apply={t('apply')} /> : null}

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
        <div className="rounded-lg border border-primary/20 bg-linen/25 px-3 py-2 text-sm text-roast">
          <strong>{t('spendEquationLabel')}:</strong>{' '}
          {formatMoney(spendTotals.capex, 'IQD', locale)} +{' '}
          {formatMoney(spendTotals.inventory, 'IQD', locale)} +{' '}
          {formatMoney(spendTotals.operating, 'IQD', locale)} ={' '}
          <strong>{formatMoney(spendTotals.totalSpent, 'IQD', locale)}</strong>.
          <span className="ms-1 text-muted-foreground">{t('spendEquationHint')}</span>
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
