import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getProductProfitabilityReport } from '@/server/finance/reports';
import { buildFinanceExportHref } from '@/lib/filters';
import { formatMoney, formatNumber, formatPercent } from '@/lib/money';
import { KpiCard } from '@/components/kpi/KpiCard';
import { BarChartCard } from '@/components/charts/Charts';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { PageHeader } from '@/components/ui/primitives';

export default async function ProductProfitabilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, filters, scope, range } = await getPageContext(params, searchParams, 'view:finance');
  const t = await getTranslations('finance');
  const tt = await getTranslations('table');
  const tr = await getTranslations('records');
  const tc = await getTranslations('common');

  const report = await getProductProfitabilityReport(filters, scope, range);
  const columns: Column[] = [
    { label: tt('product') },
    { label: tt('sku') },
    { label: t('productGroup') },
    { label: tt('units'), align: 'end' },
    { label: tt('netSales'), align: 'end' },
    { label: tt('cogs'), align: 'end' },
    { label: tt('margin'), align: 'end' },
    { label: tt('marginPct'), align: 'end' },
  ];
  const rows = report.rows.map((row) => [
    row.name[locale],
    row.sku,
    row.groupName[locale],
    formatNumber(row.units, locale),
    formatMoney(row.netSales, 'IQD', locale),
    formatMoney(row.cogs, 'IQD', locale),
    formatMoney(row.grossProfit, 'IQD', locale),
    formatPercent(row.grossMarginPct, locale),
  ]);
  const chartData = report.rows
    .slice(0, 10)
    .map((row) => ({ label: row.sku, value: row.grossProfit }));

  return (
    <>
      <BackLink href="/finance/reports" label={tr('back')} />
      <PageHeader title={t('productProfitability')} subtitle={t('productProfitabilitySubtitle')} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={tt('netSales')} value={formatMoney(report.totals.netSales, 'IQD', locale)} locale={locale} />
        <KpiCard label={tt('cogs')} value={formatMoney(report.totals.cogs, 'IQD', locale)} locale={locale} invertDelta />
        <KpiCard label={tt('margin')} value={formatMoney(report.totals.grossProfit, 'IQD', locale)} locale={locale} />
        <KpiCard label={tt('marginPct')} value={formatPercent(report.totals.grossMarginPct, locale)} locale={locale} />
      </section>

      {chartData.length ? (
        <BarChartCard title={t('topProductProfit')} data={chartData} locale={locale} valueKind="iqd" horizontal />
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('productProfitability')}</h3>
        <DataTable
          columns={columns}
          rows={rows}
          exportHref={buildFinanceExportHref('product-profitability', filters, locale)}
          exportLabel={tc('exportCsv')}
          emptyLabel={tc('noData')}
        />
      </section>
    </>
  );
}
