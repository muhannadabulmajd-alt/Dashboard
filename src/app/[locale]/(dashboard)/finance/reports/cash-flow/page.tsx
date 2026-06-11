import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getCashFlowReport } from '@/server/finance/reports';
import { buildFinanceExportHref } from '@/lib/filters';
import { formatMoney, formatNumber } from '@/lib/money';
import { KpiCard } from '@/components/kpi/KpiCard';
import { BarChartCard } from '@/components/charts/Charts';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { PageHeader } from '@/components/ui/primitives';

export default async function CashFlowReportPage({
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

  const report = await getCashFlowReport(filters, scope, range);
  const columns: Column[] = [
    { label: t('category') },
    { label: t('count'), align: 'end' },
    { label: t('amount'), align: 'end' },
  ];
  const rowsFor = (rows: typeof report.cashIn) =>
    rows.map((row) => [
      t(`cashFlowBuckets.${row.key}`),
      formatNumber(row.count, locale),
      formatMoney(row.amount, 'IQD', locale),
    ]);

  const chartData = [
    { label: t('cashIn'), value: report.totalIn },
    { label: t('cashOut'), value: report.totalOut },
    { label: t('netCashMovement'), value: report.netMovement },
  ];

  return (
    <>
      <BackLink href="/finance/reports" label={tr('back')} />
      <PageHeader title={t('cashFlow')} subtitle={t('cashFlowSubtitle')} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard label={t('cashIn')} value={formatMoney(report.totalIn, 'IQD', locale)} locale={locale} />
        <KpiCard label={t('cashOut')} value={formatMoney(report.totalOut, 'IQD', locale)} locale={locale} invertDelta />
        <KpiCard label={t('netCashMovement')} value={formatMoney(report.netMovement, 'IQD', locale)} locale={locale} />
      </section>

      <BarChartCard title={t('cashFlowChart')} data={chartData} locale={locale} valueKind="iqd" />

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('cashIn')}</h3>
          <DataTable
            columns={columns}
            rows={rowsFor(report.cashIn)}
            exportHref={buildFinanceExportHref('cash-flow', filters, locale)}
            exportLabel={tc('exportCsv')}
            emptyLabel={tc('noData')}
          />
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('cashOut')}</h3>
          <DataTable columns={columns} rows={rowsFor(report.cashOut)} emptyLabel={tc('noData')} />
        </div>
      </section>
    </>
  );
}
