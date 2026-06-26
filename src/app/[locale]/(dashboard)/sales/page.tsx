import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getOrders, getOrderLines, getActiveCatalog } from '@/server/db/repositories/sales.repo';
import * as M from '@/lib/metrics';
import { enumLabel } from '@/lib/enums';
import { ARRAY_FILTER_KEYS, buildExportHref, serializeFilters, type DashboardFilters } from '@/lib/filters';
import { formatMoney, formatNumber, formatPercent } from '@/lib/money';
import { KpiCard } from '@/components/kpi/KpiCard';
import { LineChartCard, BarChartCard, DonutChartCard } from '@/components/charts/Charts';
import { DataTable } from '@/components/data-table/DataTable';
import { DrilldownBanner } from '@/components/insights/DrilldownBanner';
import { PageHeader } from '@/components/ui/primitives';

function salesHref(filters: DashboardFilters, extra: Partial<DashboardFilters>) {
  const sp = serializeFilters({ ...filters, ...extra });
  const query = sp.toString();
  return query ? `/sales?${query}` : '/sales';
}

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
  const avgPerDay = M.averageOrdersPerDay(orders, range);

  const trend = M.salesTimeSeries(orders, 'day').map((p) => ({
    label: p.label.slice(5),
    value: p.netSales,
    href: salesHref(filters, { range: 'custom', from: p.key, to: p.key }),
  }));
  const mix = M.productMix(lines).slice(0, 8).map((p) => ({ label: p.name[locale], value: p.netSales, href: salesHref(filters, { sku: [p.sku] }) }));
  const byGrind = M.preferenceBy(lines, 'grind').map((g) => ({ label: enumLabel(g.key, locale), value: g.units, href: salesHref(filters, { grind: [g.key] }) }));
  const bySize = M.preferenceBy(lines, 'sizeLabel').map((g) => ({ label: g.key, value: g.units, href: salesHref(filters, { sizeLabel: [g.key] }) }));
  const byCity = M.salesByDimension(orders, 'governorate').map((b) => ({
    label: enumLabel(b.key, locale),
    value: b.netSales,
    href: salesHref(filters, { governorate: [b.key] }),
  }));
  // Count-based companions to the amount charts: performance by number of orders.
  const ordersByCity = M.salesByDimension(orders, 'governorate')
    .map((b) => ({ label: enumLabel(b.key, locale), value: b.orders, href: salesHref(filters, { governorate: [b.key] }) }))
    .sort((a, b) => b.value - a.value);
  const ordersByChannel = M.salesByDimension(orders, 'channel')
    .map((b) => ({ label: enumLabel(b.key, locale), value: b.orders, href: salesHref(filters, { channel: [b.key] }) }))
    .sort((a, b) => b.value - a.value);

  // Parent-product (group) revenue — variations rolled up to their parent.
  const byGroup = M.salesByGroup(lines)
    .slice(0, 8)
    .map((g) => ({ label: locale === 'ar' ? g.nameAr : g.nameEn, value: g.netSales, href: salesHref(filters, { productGroup: [g.key] }) }));

  const top = M.topProducts(lines, 10);
  const slow = M.slowMovers(lines, catalog, 10);
  const activeChips = [
    filters.range !== 'all' ? `${locale === 'ar' ? 'الفترة' : 'Range'}: ${filters.range}` : null,
    filters.from || filters.to ? `${filters.from ?? '...'} - ${filters.to ?? '...'}` : null,
    ...ARRAY_FILTER_KEYS.flatMap((key) => (filters[key] ?? []).map((value) => `${key}: ${value}`)),
  ].filter(Boolean) as string[];

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

      {activeChips.length ? (
        <DrilldownBanner
          title={locale === 'ar' ? 'نتيجة مبيعات مفلترة' : 'Filtered sales result'}
          description={locale === 'ar' ? 'هذه الأرقام والجداول تعرض نتيجة الفلاتر الحالية أو العنصر الذي ضغطت عليه في الرسم.' : 'These numbers and rows show the current filters or the chart item you opened.'}
          chips={activeChips}
          totalLabel={tk('netSales')}
          totalValue={formatMoney(net, 'IQD', locale)}
          rowsLabel={tk('orders')}
          rowsValue={formatNumber(orderCount, locale)}
          backHref="/sales"
          backLabel={locale === 'ar' ? 'العودة للمبيعات' : 'Back to sales'}
          clearHref="/sales"
          clearLabel={locale === 'ar' ? 'مسح الفلاتر' : 'Clear filters'}
        />
      ) : null}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard label={tk('netSales')} value={formatMoney(net, 'IQD', locale)} locale={locale} />
        <KpiCard label={tk('orders')} value={formatNumber(orderCount, locale)} locale={locale} />
        <KpiCard label={tk('avgOrdersPerDay')} value={formatNumber(avgPerDay, locale)} locale={locale} />
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
