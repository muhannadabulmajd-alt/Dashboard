import { getTranslations } from 'next-intl/server';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { getOrders, getPrevOrders, getOrderLines } from '@/server/db/repositories/sales.repo';
import { getInventoryItems } from '@/server/db/repositories/inventory.repo';
import { getExpenses } from '@/server/db/repositories/finance.repo';
import * as M from '@/lib/metrics';
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

  const [orders, prevOrders, lines, items, expenses] = await Promise.all([
    getOrders(filters, scope, range),
    getPrevOrders(filters, scope, range),
    getOrderLines(filters, scope, range),
    getInventoryItems(filters, scope, range),
    getExpenses(filters, scope, range),
  ]);

  const showFinancial = can(user.role, 'view:financial');

  const net = M.netSales(orders);
  const prevNet = M.netSales(prevOrders);
  const orderCount = M.completedOrderCount(orders);
  const prevOrderCount = M.completedOrderCount(prevOrders);
  const units = M.unitsSold(lines);
  const cogs = M.cogs(lines);
  const margin = M.grossMargin(net, cogs);
  const aov = M.aov(net, orderCount);
  const opex = M.operatingExpenses(expenses, 'IQD');
  const cash = M.operatingProfit(margin.amount, opex);
  const { dayOfMonth, daysInMonth } = monthProgress();
  const runRate = M.runRate(net, dayOfMonth, daysInMonth);

  const trend = M.salesTimeSeries(orders, 'day').map((p) => ({ label: p.label.slice(5), value: p.netSales }));
  const byChannel = M.salesByDimension(orders, 'channel').map((b) => ({
    label: enumLabel(b.key, locale),
    value: b.netSales,
  }));
  const top = M.topProducts(lines, 8).map((p) => ({ label: p.name[locale], value: p.netSales }));

  const reorder = M.reorderAlerts(items);
  const expiry = M.nearExpiry(items, 21);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

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
            <CardTitle>{t('stockAlerts')}</CardTitle>
            <Badge variant={reorder.length + expiry.length > 0 ? 'warning' : 'success'}>
              {formatNumber(reorder.length + expiry.length, locale)}
            </Badge>
          </CardHeader>
          <CardContent>
            {reorder.length + expiry.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('noAlerts')}</p>
            ) : (
              <ul className="divide-y text-sm">
                {reorder.slice(0, 5).map((r) => (
                  <li key={r.item.id} className="flex items-center justify-between py-2">
                    <span className="flex items-center gap-2">
                      <AlertTriangle className="size-4 text-warning" />
                      {r.item[locale === 'ar' ? 'nameAr' : 'nameEn']}
                    </span>
                    <span className="tabular text-muted-foreground">
                      {formatNumber(r.current, locale)} {r.item.unit}
                    </span>
                  </li>
                ))}
                {expiry.slice(0, 5).map((e, i) => (
                  <li key={`e${i}`} className="flex items-center justify-between py-2">
                    <span className="flex items-center gap-2">
                      <CalendarClock className="size-4 text-danger" />
                      {e.item[locale === 'ar' ? 'nameAr' : 'nameEn']}
                    </span>
                    <span className="tabular text-muted-foreground">{formatNumber(e.daysToExpiry, locale)}d</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {!showFinancial ? <p className="text-xs text-muted-foreground">{t('financialHidden')}</p> : null}
    </>
  );
}
