import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getOrders, getOrderLines, getPrevOrders } from '@/server/db/repositories/sales.repo';
import * as M from '@/lib/metrics';
import type { DimensionBucket } from '@/lib/metrics/types';
import { enumLabel } from '@/lib/enums';
import { formatMoney, formatNumber, formatPercent, type AppLocale } from '@/lib/money';
import { DataTable } from '@/components/data-table/DataTable';
import { PageHeader } from '@/components/ui/primitives';

function deltaNode(d: number | undefined, locale: AppLocale) {
  if (d === undefined || !Number.isFinite(d)) return '—';
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  const cls = d > 0 ? 'text-success' : d < 0 ? 'text-danger' : 'text-muted-foreground';
  return <span className={`font-medium ${cls}`}>{sign}{formatPercent(Math.abs(d), locale)}</span>;
}

function mergeDimensions(
  cur: DimensionBucket[],
  prev: DimensionBucket[],
  locale: AppLocale,
) {
  const prevMap = new Map(prev.map((b) => [b.key, b.netSales] as const));
  const keys = new Set([...cur.map((b) => b.key), ...prev.map((b) => b.key)]);
  const curMap = new Map(cur.map((b) => [b.key, b.netSales] as const));
  return [...keys]
    .map((k) => ({ key: k, cur: curMap.get(k) ?? 0, prev: prevMap.get(k) ?? 0 }))
    .sort((a, b) => b.cur - a.cur)
    .map((r) => [
      enumLabel(r.key, locale),
      formatMoney(r.cur, 'IQD', locale),
      formatMoney(r.prev, 'IQD', locale),
      deltaNode(M.deltaPct(r.cur, r.prev), locale),
    ]);
}

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, filters, scope, range } = await getPageContext(params, searchParams, 'view:dashboard');
  const t = await getTranslations('compare');
  const tk = await getTranslations('kpi');

  const prevRange = range.prevStart && range.prevEnd ? { start: range.prevStart, end: range.prevEnd } : null;
  const [orders, lines, prevOrders, prevLines] = await Promise.all([
    getOrders(filters, scope, range),
    getOrderLines(filters, scope, range),
    getPrevOrders(filters, scope, range),
    prevRange ? getOrderLines(filters, scope, prevRange) : Promise.resolve([]),
  ]);

  const net = M.netSales(orders);
  const prevNet = M.netSales(prevOrders);
  const oc = M.completedOrderCount(orders);
  const prevOc = M.completedOrderCount(prevOrders);
  const units = M.unitsSold(lines);
  const prevUnits = M.unitsSold(prevLines);
  const aov = M.aov(net, oc);
  const prevAov = M.aov(prevNet, prevOc);

  const headCols = [
    { label: t('metric') },
    { label: t('current'), align: 'end' as const },
    { label: t('previous'), align: 'end' as const },
    { label: t('delta'), align: 'end' as const },
  ];
  const headRows = [
    [tk('netSales'), formatMoney(net, 'IQD', locale), formatMoney(prevNet, 'IQD', locale), deltaNode(M.deltaPct(net, prevNet), locale)],
    [tk('orders'), formatNumber(oc, locale), formatNumber(prevOc, locale), deltaNode(M.deltaPct(oc, prevOc), locale)],
    [tk('units'), formatNumber(units, locale), formatNumber(prevUnits, locale), deltaNode(M.deltaPct(units, prevUnits), locale)],
    [tk('aov'), formatMoney(aov, 'IQD', locale), formatMoney(prevAov, 'IQD', locale), deltaNode(M.deltaPct(aov, prevAov), locale)],
  ];

  const dimCols = (first: string) => [
    { label: first },
    { label: t('current'), align: 'end' as const },
    { label: t('previous'), align: 'end' as const },
    { label: t('delta'), align: 'end' as const },
  ];

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('metric')}</h3>
        <DataTable columns={headCols} rows={headRows} emptyLabel="—" />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('byChannel')}</h3>
          <DataTable
            columns={dimCols(t('byChannel'))}
            rows={mergeDimensions(M.salesByDimension(orders, 'channel'), M.salesByDimension(prevOrders, 'channel'), locale)}
            emptyLabel="—"
          />
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('byCity')}</h3>
          <DataTable
            columns={dimCols(t('byCity'))}
            rows={mergeDimensions(M.salesByDimension(orders, 'governorate'), M.salesByDimension(prevOrders, 'governorate'), locale)}
            emptyLabel="—"
          />
        </div>
      </section>
    </>
  );
}
