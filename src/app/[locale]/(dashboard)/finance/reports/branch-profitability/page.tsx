import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getBranchProfitabilityReport } from '@/server/finance/reports';
import { buildFinanceExportHref } from '@/lib/filters';
import { formatMoney, formatNumber, formatPercent } from '@/lib/money';
import { KpiCard } from '@/components/kpi/KpiCard';
import { BarChartCard } from '@/components/charts/Charts';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { PageHeader } from '@/components/ui/primitives';

export default async function BranchProfitabilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, filters, scope, range } = await getPageContext(params, searchParams, 'view:finance');
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const tc = await getTranslations('common');

  const rows = await getBranchProfitabilityReport(filters, scope, range);
  const totals = rows.reduce(
    (sum, row) => ({
      orders: sum.orders + row.orders,
      netSales: sum.netSales + row.netSales,
      cogs: sum.cogs + row.cogs,
      operatingExpenses: sum.operatingExpenses + row.operatingExpenses,
      operatingProfit: sum.operatingProfit + row.operatingProfit,
    }),
    { orders: 0, netSales: 0, cogs: 0, operatingExpenses: 0, operatingProfit: 0 },
  );
  const best = rows[0];
  const columns: Column[] = [
    { label: t('f.branch') },
    { label: t('orders'), align: 'end' },
    { label: t('netSales'), align: 'end' },
    { label: t('cogs'), align: 'end' },
    { label: t('grossProfit'), align: 'end' },
    { label: t('operatingExpenses'), align: 'end' },
    { label: t('operatingProfit'), align: 'end' },
    { label: t('operatingMargin'), align: 'end' },
  ];
  const tableRows = rows.map((row) => [
    row.branchName[locale],
    formatNumber(row.orders, locale),
    formatMoney(row.netSales, 'IQD', locale),
    formatMoney(row.cogs, 'IQD', locale),
    formatMoney(row.grossProfit, 'IQD', locale),
    formatMoney(row.operatingExpenses, 'IQD', locale),
    formatMoney(row.operatingProfit, 'IQD', locale),
    formatPercent(row.operatingMarginPct, locale),
  ]);
  const chartData = rows.map((row) => ({ label: row.branchName[locale], value: row.operatingProfit }));

  return (
    <>
      <BackLink href="/finance/reports" label={tr('back')} />
      <PageHeader title={t('branchProfitability')} subtitle={t('branchProfitabilitySubtitle')} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={t('netSales')} value={formatMoney(totals.netSales, 'IQD', locale)} locale={locale} />
        <KpiCard label={t('operatingExpenses')} value={formatMoney(totals.operatingExpenses, 'IQD', locale)} locale={locale} invertDelta />
        <KpiCard label={t('operatingProfit')} value={formatMoney(totals.operatingProfit, 'IQD', locale)} locale={locale} />
        <KpiCard label={t('topBranch')} value={best?.branchName[locale] ?? '—'} locale={locale} sub={best ? formatMoney(best.operatingProfit, 'IQD', locale) : undefined} />
      </section>

      {chartData.length ? (
        <BarChartCard title={t('branchOperatingProfit')} data={chartData} locale={locale} valueKind="iqd" horizontal />
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('branchProfitability')}</h3>
        <DataTable
          columns={columns}
          rows={tableRows}
          exportHref={buildFinanceExportHref('branch-profitability', filters, locale)}
          exportLabel={tc('exportCsv')}
          emptyLabel={tc('noData')}
        />
      </section>
    </>
  );
}
