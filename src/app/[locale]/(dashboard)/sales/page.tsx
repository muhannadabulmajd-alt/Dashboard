import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getOrders, getOrderLines, getActiveCatalog } from '@/server/db/repositories/sales.repo';
import * as M from '@/lib/metrics';
import { enumLabel } from '@/lib/enums';
import { buildExportHref } from '@/lib/filters';
import { formatMoney, formatNumber, formatPercent } from '@/lib/money';
import { KpiCard } from '@/components/kpi/KpiCard';
import { LineChartCard, BarChartCard, DonutChartCard } from '@/components/charts/Charts';
import { DataTable } from '@/components/data-table/DataTable';
import { PageHeader } from '@/components/ui/primitives';

export default async function SalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, filters, scope, range } = await getPageContext(params, searchParams, 'view:sales');
  const t = await getTranslations('sales');
  const tk = await getTranslations('kpi');
  const tt = await getTranslations('table');
  const tc = await getTranslations('common');

  const [orders, lines, catalog] = await Promise.all([
    getOrders(filters, scope, range),
    getOrderLines(filters, scope, range),
    getActiveCatalog(),
  ]);

  const net = M.netSales(orders);
  const orderCount = M.salesOrderCount(orders);
  const units = M.unitsSold(lines);
  const discount = M.discountEffect(orders);

  const trend = M.salesTimeSeries(orders, 'day').map((p) => ({ label: p.label.slice(5), value: p.netSales }));
  const mix = M.productMix(lines).slice(0, 8).map((p) => ({ label: p.name[locale], value: p.netSales }));
  const byGrind = M.preferenceBy(lines, 'grind').map((g) => ({ label: enumLabel(g.key, locale), value: g.units }));
  const bySize = M.preferenceBy(lines, 'sizeLabel').map((g) => ({ label: g.key, value: g.units }));
  const byCity = M.salesByDimension(orders, 'governorate').map((b) => ({
    label: enumLabel(b.key, locale),
    value: b.netSales,
  }));
  // Count-based companions to the amount charts: performance by number of orders.
  const ordersByCity = M.salesByDimension(orders, 'governorate')
    .map((b) => ({ label: enumLabel(b.key, locale), value: b.orders }))
    .sort((a, b) => b.value - a.value);
  const ordersByChannel = M.salesByDimension(orders, 'channel')
    .map((b) => ({ label: enumLabel(b.key, locale), value: b.orders }))
    .sort((a, b) => b.value - a.value);

  // Parent-product (group) revenue — variations rolled up to their parent.
  const byGroup = M.salesByGroup(lines)
    .slice(0, 8)
    .map((g) => ({ label: locale === 'ar' ? g.nameAr : g.nameEn, value: g.netSales }));

  const top = M.topProducts(lines, 10);
  const slow = M.slowMovers(lines, catalog, 10);

  const productRows = (rows: typeof top) =>
    rows.map((p) => [p.name[locale], p.sku, formatNumber(p.units, locale), formatMoney(p.netSales, 'IQD', locale)]);
  const cols = [
    { label: tt('product') },
    { label: tt('sku') },
    { label: tt('units'), align: 'end' as const },
    { label: tt('netSales'), align: 'end' as const },
  ];

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label={tk('netSales')} value={formatMoney(net, 'IQD', locale)} locale={locale} />
        <KpiCard label={tk('orders')} value={formatNumber(orderCount, locale)} locale={locale} />
        <KpiCard label={tk('units')} value={formatNumber(units, locale)} locale={locale} />
        <KpiCard label={tk('aov')} value={formatMoney(M.aov(net, orderCount), 'IQD', locale)} locale={locale} />
        <KpiCard
          label={tk('discount')}
          value={formatMoney(discount.discountSpend, 'IQD', locale)}
          sub={formatPercent(discount.effectivePct, locale)}
          locale={locale}
          invertDelta
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <LineChartCard title={t('trend')} data={trend} locale={locale} valueKind="iqd" />
        <DonutChartCard title={t('productMix')} data={mix} locale={locale} valueKind="iqd" />
      </section>

      {byGroup.length ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <BarChartCard title={t('topGroups')} data={byGroup} locale={locale} valueKind="iqd" horizontal />
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <BarChartCard title={t('grindPref')} data={byGrind} locale={locale} valueKind="count" />
        <BarChartCard title={t('sizePref')} data={bySize} locale={locale} valueKind="count" />
        <BarChartCard title={t('byCity')} data={byCity} locale={locale} valueKind="iqd" horizontal />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <BarChartCard title={t('ordersByCity')} data={ordersByCity} locale={locale} valueKind="count" horizontal />
        <BarChartCard title={t('ordersByChannel')} data={ordersByChannel} locale={locale} valueKind="count" horizontal />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('topProducts')}</h3>
          <DataTable
            columns={cols}
            rows={productRows(top)}
            exportHref={buildExportHref('top_products', filters, locale)}
            exportLabel={tc('exportCsv')}
            emptyLabel={tc('noData')}
          />
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('slowMovers')}</h3>
          <DataTable columns={cols} rows={productRows(slow)} emptyLabel={tc('noData')} />
        </div>
      </section>
    </>
  );
}
