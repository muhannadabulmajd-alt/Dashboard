import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getOrders, getOrderLines } from '@/server/db/repositories/sales.repo';
import { getCustomers, getOrderHistory } from '@/server/db/repositories/customers.repo';
import * as M from '@/lib/metrics';
import { enumLabel } from '@/lib/enums';
import { formatNumber, formatPercent } from '@/lib/money';
import { KpiCard } from '@/components/kpi/KpiCard';
import { DonutChartCard, BarChartCard } from '@/components/charts/Charts';
import { DataTable } from '@/components/data-table/DataTable';
import { ActionLink, PageHeader } from '@/components/ui/primitives';
import { monthBucketKey } from '@/lib/dates';

function monthIndex(key: string): number {
  const [y, m] = key.split('-').map(Number);
  return y * 12 + (m - 1);
}

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, filters, scope, range } = await getPageContext(params, searchParams, 'view:customers');
  const t = await getTranslations('customers');
  const tt = await getTranslations('table');
  const tc = await getTranslations('common');

  const [orders, lines, customers, history] = await Promise.all([
    getOrders(filters, scope, range),
    getOrderLines(filters, scope, range),
    getCustomers(scope),
    getOrderHistory(scope),
  ]);

  const firstOrderById = new Map(customers.map((c) => [c.id, c.firstOrderAt] as const));
  const nr = M.classifyNewReturning(orders, firstOrderById, range.start, range.end);
  const conversion = M.firstToSecondConversion(history, range.start, range.end, 30);

  const segments = M.frequencySegmentCounts(customers).map((s) => ({
    label: enumLabel(s.segment, locale),
    value: s.count,
  }));
  const byCity = M.customersByCity(customers).map((c) => ({ label: enumLabel(c.governorate, locale), value: c.count }));
  const preferred = M.topProducts(lines, 10);

  // Cohort grid, blanking months that have not yet elapsed.
  const nowIdx = monthIndex(monthBucketKey(new Date()));
  const cohorts = M.cohortRetention(history, 6);
  const cohortCols = [
    { label: t('cohortMonth') },
    { label: t('size'), align: 'end' as const },
    ...Array.from({ length: 6 }, (_, k) => ({ label: `+${k}`, align: 'end' as const })),
  ];
  const cohortRows = cohorts.map((c) => {
    const elapsed = nowIdx - monthIndex(c.cohort);
    return [
      c.cohort,
      formatNumber(c.size, locale),
      ...c.retention.map((r, k) => (k <= elapsed ? formatPercent(r, locale, 0) : '—')),
    ];
  });

  const prefCols = [{ label: tt('product') }, { label: tt('units'), align: 'end' as const }];
  const prefRows = preferred.map((p) => [p.name[locale], formatNumber(p.units, locale)]);

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<ActionLink href="/customers/product-buyers">{t('productBuyers')}</ActionLink>}
      />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label={t('unique')} value={formatNumber(nr.total, locale)} locale={locale} />
        <KpiCard label={t('new')} value={formatNumber(nr.newCount, locale)} locale={locale} />
        <KpiCard label={t('returning')} value={formatNumber(nr.returning, locale)} locale={locale} />
        <KpiCard label={t('repeatRate')} value={formatPercent(M.repeatPurchaseRate(nr), locale)} locale={locale} />
        <KpiCard label={t('conversion')} value={formatPercent(conversion, locale)} locale={locale} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <DonutChartCard title={t('segments')} data={segments} locale={locale} valueKind="count" />
        <BarChartCard title={t('byCity')} data={byCity} locale={locale} valueKind="count" horizontal />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('cohort')}</h3>
        <DataTable columns={cohortCols} rows={cohortRows} emptyLabel={tc('noData')} />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('preferred')}</h3>
        <DataTable columns={prefCols} rows={prefRows} emptyLabel={tc('noData')} />
      </section>
    </>
  );
}
