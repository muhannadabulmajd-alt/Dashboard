import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getOrders, getOrderLines } from '@/server/db/repositories/sales.repo';
import { getExpenses } from '@/server/db/repositories/finance.repo';
import * as M from '@/lib/metrics';
import { enumLabel } from '@/lib/enums';
import { buildExportHref, buildFinanceExportHref } from '@/lib/filters';
import { formatMoney, formatNumber, formatPercent } from '@/lib/money';
import { monthProgress, resolveRange } from '@/lib/dates';
import { can } from '@/lib/rbac';
import { prisma } from '@/server/db/client';
import { Download } from 'lucide-react';
import { KpiCard } from '@/components/kpi/KpiCard';
import { WaterfallChart, BarChartCard, type WaterfallStep } from '@/components/charts/Charts';
import { DataTable } from '@/components/data-table/DataTable';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { SectionGuide } from '@/components/records/SectionGuide';

export default async function PnlPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Finance-gated: non-finance roles are redirected to the dashboard home.
  const { locale, user, filters, scope, range } = await getPageContext(params, searchParams, 'view:financial');
  const t = await getTranslations('pnl');
  const tf = await getTranslations('finance');
  const tk = await getTranslations('kpi');
  const tt = await getTranslations('table');
  const tc = await getTranslations('common');
  const canExport = can(user.role, 'export:financial');

  const now = new Date();
  const mtdRange = resolveRange({ range: 'this_month' }, now);
  const [orders, lines, expenses, mtdOrders] = await Promise.all([
    getOrders(filters, scope, range),
    getOrderLines(filters, scope, range),
    getExpenses(filters, scope, range),
    getOrders(filters, scope, { start: mtdRange.start, end: mtdRange.end }),
  ]);

  const pnl = M.buildPnlSnapshot(orders, lines, expenses);
  const { grossRevenue: gross, discounts, refunds, netSales: net, cogs, operatingExpenses: opex, directDeliveryCost: deliveryCosts, operatingProfit: profit } = pnl;
  const margin = { amount: pnl.grossProfit, pct: pnl.grossMarginPct };
  const contribution = M.contributionMargin(net, cogs, { delivery: deliveryCosts });

  // Cost/margin alerts (§9/§17): active products priced below cost or thin margin.
  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { sku: 'asc' },
    select: { sku: true, nameEn: true, nameAr: true, sellingPrice: true, cogsPerUnit: true, sellingCurrency: true },
  });
  const rank = { belowCost: 0, lowMargin: 1, ok: 2 };
  const marginAlerts = products
    .map((p) => ({ p, status: M.marginStatus(p.sellingPrice, p.cogsPerUnit) }))
    .filter((a) => a.status !== 'ok')
    .sort((a, b) => rank[a.status] - rank[b.status]);

  const { dayOfMonth, daysInMonth } = monthProgress();
  const runRate = M.runRate(M.netSales(mtdOrders), dayOfMonth, daysInMonth);

  const waterfall: WaterfallStep[] = [
    { label: t('revenue'), value: gross, kind: 'total' },
    { label: t('discounts'), value: discounts, kind: 'dec' },
    { label: t('refunds'), value: refunds, kind: 'dec' },
    { label: t('netSales'), value: net, kind: 'total' },
    { label: t('cogs'), value: cogs, kind: 'dec' },
    { label: t('grossMargin'), value: margin.amount, kind: 'total' },
    { label: t('deliveryCosts'), value: deliveryCosts, kind: 'dec' },
    { label: t('operatingCosts'), value: opex, kind: 'dec' },
    { label: t('operatingProfit'), value: profit, kind: 'total' },
  ];

  const costsByCat = M.expensesByCategory(expenses, 'IQD').map((c) => ({
    label: enumLabel(c.category, locale),
    value: c.amount,
  }));

  const marginRows = M.productMargin(lines)
    .slice(0, 15)
    .map((r) => [
      r.name[locale],
      r.sku,
      formatNumber(r.units, locale),
      formatMoney(r.netSales, 'IQD', locale),
      formatMoney(r.cogs, 'IQD', locale),
      formatMoney(r.marginAmount, 'IQD', locale),
      formatPercent(r.marginPct, locale),
    ]);
  const marginCols = [
    { label: tt('product') },
    { label: tt('sku') },
    { label: tt('units'), align: 'end' as const },
    { label: tt('netSales'), align: 'end' as const },
    { label: tt('cogs'), align: 'end' as const },
    { label: tt('margin'), align: 'end' as const },
    { label: tt('marginPct'), align: 'end' as const },
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        {canExport ? (
          <a
            href={buildFinanceExportHref('pnl', filters, locale)}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <Download className="size-3.5" />
            {tc('exportCsv')}
          </a>
        ) : null}
      </div>
      <SectionGuide
        title={tf('guide.pnl.title')}
        intro={tf('guide.pnl.intro')}
        points={tf.raw('guide.pnl.points')}
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={tk('netSales')} value={formatMoney(net, 'IQD', locale)} locale={locale} />
        <KpiCard label={tk('cogs')} value={formatMoney(cogs, 'IQD', locale)} locale={locale} invertDelta />
        <KpiCard label={tk('grossMargin')} value={formatPercent(margin.pct, locale)} sub={formatMoney(margin.amount, 'IQD', locale)} locale={locale} />
        <KpiCard label={tk('contributionMargin')} value={formatMoney(contribution, 'IQD', locale)} locale={locale} />
        <KpiCard label={tk('operatingProfit')} value={formatMoney(profit, 'IQD', locale)} locale={locale} />
        <KpiCard label={tk('runRate')} value={formatMoney(runRate, 'IQD', locale)} locale={locale} />
        <KpiCard label={t('operatingCosts')} value={formatMoney(opex, 'IQD', locale)} locale={locale} invertDelta />
        <KpiCard label={t('deliveryCosts')} value={formatMoney(deliveryCosts, 'IQD', locale)} locale={locale} invertDelta />
      </section>

      {marginAlerts.length ? (
        <section className="space-y-2 rounded-[var(--radius)] border border-warning/40 bg-warning-soft/30 p-4">
          <h3 className="text-sm font-bold text-warning">{t('marginAlerts')}</h3>
          <DataTable
            columns={[
              { label: tt('product') },
              { label: tt('sku') },
              { label: t('price'), align: 'end' as const },
              { label: tk('cogs'), align: 'end' as const },
              { label: tt('marginPct'), align: 'end' as const },
              { label: '' },
            ]}
            rows={marginAlerts.map(({ p, status }) => {
              const m = p.sellingPrice > 0 ? (p.sellingPrice - p.cogsPerUnit) / p.sellingPrice : 0;
              return [
                locale === 'ar' ? p.nameAr : p.nameEn,
                p.sku,
                formatMoney(p.sellingPrice, p.sellingCurrency, locale),
                formatMoney(p.cogsPerUnit, p.sellingCurrency, locale),
                formatPercent(m, locale),
                <Badge key="s" variant={status === 'belowCost' ? 'danger' : 'warning'}>
                  {status === 'belowCost' ? t('belowCost') : t('lowMargin')}
                </Badge>,
              ];
            })}
            emptyLabel={tc('noData')}
          />
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <WaterfallChart title={t('waterfall')} steps={waterfall} locale={locale} />
        <BarChartCard title={t('costsByCategory')} data={costsByCat} locale={locale} valueKind="iqd" horizontal />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('productMargin')}</h3>
        <DataTable
          columns={marginCols}
          rows={marginRows}
          exportHref={buildExportHref('product_margin', filters, locale)}
          exportLabel={tc('exportCsv')}
          emptyLabel={tc('noData')}
        />
      </section>
    </>
  );
}
