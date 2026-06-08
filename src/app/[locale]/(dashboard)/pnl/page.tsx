import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getOrders, getOrderLines } from '@/server/db/repositories/sales.repo';
import { getExpenses, getBatches } from '@/server/db/repositories/finance.repo';
import * as M from '@/lib/metrics';
import { enumLabel } from '@/lib/enums';
import { buildExportHref } from '@/lib/filters';
import { formatMoney, formatNumber, formatPercent } from '@/lib/money';
import { monthProgress } from '@/lib/dates';
import { KpiCard } from '@/components/kpi/KpiCard';
import { WaterfallChart, BarChartCard, type WaterfallStep } from '@/components/charts/Charts';
import { DataTable } from '@/components/data-table/DataTable';
import { PageHeader } from '@/components/ui/primitives';

const CUPS_PER_KG = 83; // ~12g per cup

export default async function PnlPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Finance-gated: non-finance roles are redirected to the dashboard home.
  const { locale, filters, scope, range } = await getPageContext(params, searchParams, 'view:financial');
  const t = await getTranslations('pnl');
  const tk = await getTranslations('kpi');
  const tt = await getTranslations('table');
  const tc = await getTranslations('common');

  const [orders, lines, expenses, batches] = await Promise.all([
    getOrders(filters, scope, range),
    getOrderLines(filters, scope, range),
    getExpenses(filters, scope, range),
    getBatches(filters, scope, range),
  ]);

  const gross = M.grossSales(orders);
  const discounts = M.discountTotal(orders);
  const refunds = M.refundTotal(orders);
  const net = M.netSales(orders);
  const cogs = M.cogs(lines);
  const margin = M.grossMargin(net, cogs);
  const opex = M.operatingExpenses(expenses, 'IQD');
  const profit = M.operatingProfit(margin.amount, opex);
  const contribution = M.contributionMargin(net, cogs, { delivery: M.deliveryCostTotal(orders) });

  const greenSpend = expenses.filter((e) => e.categoryType === 'GREEN_COFFEE').reduce((s, e) => s + e.amount, 0);
  const roastedKg = M.totalRoastedOutput(batches) / 1000;
  const costPerKg = roastedKg > 0 ? Math.round(greenSpend / roastedKg) : 0;
  const costPerCup = Math.round(M.costPerCup(costPerKg, CUPS_PER_KG));

  const { dayOfMonth, daysInMonth } = monthProgress();
  const runRate = M.runRate(net, dayOfMonth, daysInMonth);

  const waterfall: WaterfallStep[] = [
    { label: t('revenue'), value: gross, kind: 'total' },
    { label: t('discounts'), value: discounts, kind: 'dec' },
    { label: t('refunds'), value: refunds, kind: 'dec' },
    { label: t('netSales'), value: net, kind: 'total' },
    { label: t('cogs'), value: cogs, kind: 'dec' },
    { label: t('grossMargin'), value: margin.amount, kind: 'total' },
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
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={tk('netSales')} value={formatMoney(net, 'IQD', locale)} locale={locale} />
        <KpiCard label={tk('cogs')} value={formatMoney(cogs, 'IQD', locale)} locale={locale} invertDelta />
        <KpiCard label={tk('grossMargin')} value={formatPercent(margin.pct, locale)} sub={formatMoney(margin.amount, 'IQD', locale)} locale={locale} />
        <KpiCard label={tk('contributionMargin')} value={formatMoney(contribution, 'IQD', locale)} locale={locale} />
        <KpiCard label={tk('cashBurn')} value={formatMoney(profit, 'IQD', locale)} locale={locale} invertDelta />
        <KpiCard label={tk('runRate')} value={formatMoney(runRate, 'IQD', locale)} locale={locale} />
        <KpiCard label={t('perKg')} value={formatMoney(costPerKg, 'IQD', locale)} locale={locale} invertDelta />
        <KpiCard label={t('perCup')} value={formatMoney(costPerCup, 'IQD', locale)} locale={locale} invertDelta />
      </section>

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
