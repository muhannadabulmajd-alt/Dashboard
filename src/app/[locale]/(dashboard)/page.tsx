import { getTranslations } from 'next-intl/server';
import { AlertTriangle, CalendarClock, FileDown, PackageX, TrendingDown } from 'lucide-react';
import { serializeFilters } from '@/lib/filters';
import { getPageContext } from '@/server/page-context';
import { getOrders, getPrevOrders, getOrderLines, getCatalogForAlerts } from '@/server/db/repositories/sales.repo';
import { getInventoryItems } from '@/server/db/repositories/inventory.repo';
import { getExpenses } from '@/server/db/repositories/finance.repo';
import * as M from '@/lib/metrics';
import type { AlertKind } from '@/lib/metrics';
import { Link } from '@/i18n/navigation';
import { can } from '@/lib/rbac';
import { enumLabel } from '@/lib/enums';
import { formatMoney, formatNumber, formatPercent } from '@/lib/money';
import { monthProgress } from '@/lib/dates';
import { KpiCard } from '@/components/kpi/KpiCard';
import { LineChartCard, BarChartCard } from '@/components/charts/Charts';
import { Card, CardContent, CardHeader, CardTitle, Badge, PageHeader } from '@/components/ui/primitives';

export default async function ExecutiveOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getPageContext(params, searchParams, 'view:dashboard');
  const { locale, user, filters, scope, range } = ctx;
  const t = await getTranslations('executive');
  const tk = await getTranslations('kpi');
  const tc = await getTranslations('common');
  const ta = await getTranslations('alerts');

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [orders, prevOrders, lines, items, expenses, catalog, mtdOrders] = await Promise.all([
    getOrders(filters, scope, range),
    getPrevOrders(filters, scope, range),
    getOrderLines(filters, scope, range),
    getInventoryItems(filters, scope, range),
    getExpenses(filters, scope, range),
    getCatalogForAlerts(),
    getOrders(filters, scope, { start: monthStart, end: now }),
  ]);

  const showFinancial = can(user.role, 'view:financial');

  const net = M.netSales(orders);
  const prevNet = M.netSales(prevOrders);
  const orderCount = M.salesOrderCount(orders);
  const prevOrderCount = M.salesOrderCount(prevOrders);
  const units = M.unitsSold(lines);
  const cogs = M.cogs(lines);
  const margin = M.grossMargin(net, cogs);
  const aov = M.aov(net, orderCount);
  const opex = M.operatingExpenses(expenses, 'IQD');
  const cash = M.operatingProfit(margin.amount, opex, M.deliveryCostTotal(orders));
  const { dayOfMonth, daysInMonth } = monthProgress();
  const runRate = M.runRate(M.netSales(mtdOrders), dayOfMonth, daysInMonth);

  const trend = M.salesTimeSeries(orders, 'day').map((p) => ({ label: p.label.slice(5), value: p.netSales }));
  const byChannel = M.salesByDimension(orders, 'channel').map((b) => ({
    label: enumLabel(b.key, locale),
    value: b.netSales,
  }));
  const top = M.topProducts(lines, 8).map((p) => ({ label: p.name[locale], value: p.netSales }));

  // Centralized notifications (§9/§17): low/out-of-stock + near-expiry from
  // inventory, plus below-cost / thin-margin products from the catalog, folded
  // into one ranked feed. Collapse expiry to the soonest lot per item.
  const expiryByItem = new Map<string, M.ExpiryAlertInput>();
  for (const e of M.nearExpiry(items, 21)) {
    const cur = expiryByItem.get(e.item.id);
    if (!cur || e.daysToExpiry < cur.daysToExpiry)
      expiryByItem.set(e.item.id, { id: e.item.id, nameEn: e.item.nameEn, nameAr: e.item.nameAr, daysToExpiry: e.daysToExpiry });
  }
  const alerts = M.buildAlerts({
    stock: items.map((it) => ({
      id: it.id,
      nameEn: it.nameEn,
      nameAr: it.nameAr,
      unit: it.unit,
      current: M.currentStock(it.movements),
      reorderPoint: it.reorderPoint,
    })),
    expiring: [...expiryByItem.values()],
    products: catalog,
  });
  const counts = M.alertCounts(alerts);

  // kind → icon + colour + link target for the notifications panel.
  const alertMeta: Record<AlertKind, { Icon: typeof AlertTriangle; href: string }> = {
    stockout: { Icon: PackageX, href: '/admin/records/inventory' },
    reorder: { Icon: AlertTriangle, href: '/admin/records/inventory' },
    expiry: { Icon: CalendarClock, href: '/inventory' },
    belowCost: { Icon: TrendingDown, href: '/admin/records/products' },
    lowMargin: { Icon: TrendingDown, href: '/pnl' },
  };
  const formatAlertValue = (a: M.AlertItem): string => {
    if (a.kind === 'expiry') return `${formatNumber(a.value, locale)}${ta('daysSuffix')}`;
    if (a.kind === 'belowCost' || a.kind === 'lowMargin') return formatPercent(a.value, locale);
    return `${formatNumber(a.value, locale)} ${a.unit ?? ''}`.trim();
  };

  const deckQuery = (() => {
    const sp = serializeFilters(filters);
    sp.set('locale', locale);
    return sp.toString();
  })();

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        {can(user.role, 'export:data') ? (
          <a
            href={`/api/reports/deck?${deckQuery}`}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <FileDown className="size-3.5" />
            {tc('downloadDeck')}
          </a>
        ) : null}
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={tk('netSales')} value={formatMoney(net, 'IQD', locale)} delta={M.deltaPct(net, prevNet)} locale={locale} />
        <KpiCard label={tk('orders')} value={formatNumber(orderCount, locale)} delta={M.deltaPct(orderCount, prevOrderCount)} locale={locale} />
        <KpiCard label={tk('units')} value={formatNumber(units, locale)} locale={locale} />
        <KpiCard label={tk('aov')} value={formatMoney(aov, 'IQD', locale)} locale={locale} />
        {showFinancial ? (
          <>
            <KpiCard label={tk('grossMargin')} value={formatPercent(margin.pct, locale)} sub={formatMoney(margin.amount, 'IQD', locale)} locale={locale} />
            <KpiCard label={tk('cashBurn')} value={formatMoney(cash, 'IQD', locale)} locale={locale} invertDelta />
            <KpiCard label={tk('runRate')} value={formatMoney(runRate, 'IQD', locale)} sub={tk('netSales')} locale={locale} />
          </>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <LineChartCard title={t('salesTrend')} data={trend} locale={locale} valueKind="iqd" />
        <BarChartCard title={t('salesByChannel')} data={byChannel} locale={locale} valueKind="iqd" horizontal />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <BarChartCard title={t('topProducts')} data={top} locale={locale} valueKind="iqd" horizontal />
        <Card>
          <CardHeader>
            <CardTitle>{ta('title')}</CardTitle>
            <Badge variant={counts.critical > 0 ? 'danger' : counts.total > 0 ? 'warning' : 'success'}>
              {counts.critical > 0
                ? ta('criticalOf', { critical: formatNumber(counts.critical, locale), total: formatNumber(counts.total, locale) })
                : formatNumber(counts.total, locale)}
            </Badge>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{ta('none')}</p>
            ) : (
              <ul className="divide-y text-sm">
                {alerts.slice(0, 8).map((a) => {
                  const { Icon, href } = alertMeta[a.kind];
                  return (
                    <li key={`${a.kind}-${a.refId}`} className="py-2">
                      <Link href={href} className="flex items-center justify-between gap-2 hover:text-primary">
                        <span className="flex min-w-0 items-center gap-2">
                          <Icon className={`size-4 shrink-0 ${a.severity === 'critical' ? 'text-danger' : 'text-warning'}`} />
                          <span className="truncate">{a.name[locale === 'ar' ? 'ar' : 'en']}</span>
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {ta(`kind.${a.kind}`)}
                          </span>
                        </span>
                        <span className="tabular shrink-0 text-muted-foreground">{formatAlertValue(a)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {!showFinancial ? <p className="text-xs text-muted-foreground">{t('financialHidden')}</p> : null}
    </>
  );
}
