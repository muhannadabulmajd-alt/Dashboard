import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getShipments } from '@/server/db/repositories/fulfillment.repo';
import { getOrders } from '@/server/db/repositories/sales.repo';
import * as M from '@/lib/metrics';
import { enumLabel } from '@/lib/enums';
import { formatMoney, formatNumber, formatPercent } from '@/lib/money';
import { KpiCard } from '@/components/kpi/KpiCard';
import { BarChartCard } from '@/components/charts/Charts';
import { DataTable } from '@/components/data-table/DataTable';
import { PageHeader } from '@/components/ui/primitives';

export default async function FulfillmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, filters, scope, range } = await getPageContext(params, searchParams, 'view:fulfillment');
  const t = await getTranslations('fulfillment');
  const tc = await getTranslations('common');

  const [shipments, orders] = await Promise.all([
    getShipments(filters, scope, range),
    getOrders(filters, scope, range),
  ]);

  const couriers = M.courierComparison(shipments);
  const cityPerf = M.cityDeliveryPerformance(shipments);
  const days = (d: number) => `${formatNumber(d, locale, 1)} d`;

  const courierBar = couriers.map((c) => ({ label: c.courier, value: c.shipments }));
  const cityBar = cityPerf.map((c) => ({ label: enumLabel(c.governorate, locale), value: c.slaPct }));

  const courierCols = [
    { label: t('courier') },
    { label: t('shipments'), align: 'end' as const },
    { label: t('delivered'), align: 'end' as const },
    { label: t('sla'), align: 'end' as const },
    { label: t('avgDelivery'), align: 'end' as const },
    { label: t('cost'), align: 'end' as const },
  ];
  const courierRows = couriers.map((c) => [
    c.courier,
    formatNumber(c.shipments, locale),
    formatNumber(c.delivered, locale),
    formatPercent(c.slaPct, locale),
    days(c.avgDays),
    formatMoney(Math.round(c.avgCost), 'IQD', locale),
  ]);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label={t('shipments')} value={formatNumber(shipments.length, locale)} locale={locale} />
        <KpiCard label={t('sla')} value={formatPercent(M.deliverySlaPct(shipments, 3), locale)} locale={locale} />
        <KpiCard label={t('avgDelivery')} value={days(M.avgDeliveryDays(shipments))} locale={locale} invertDelta />
        <KpiCard label={t('failed')} value={formatPercent(M.failedDeliveryRate(shipments), locale)} locale={locale} invertDelta />
        <KpiCard label={t('returns')} value={formatPercent(M.returnRate(orders), locale)} locale={locale} invertDelta />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <BarChartCard title={t('couriers')} data={courierBar} locale={locale} valueKind="count" horizontal />
        <BarChartCard title={t('byCity')} data={cityBar} locale={locale} valueKind="percent" horizontal />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('couriers')}</h3>
        <DataTable columns={courierCols} rows={courierRows} emptyLabel={tc('noData')} />
      </section>
    </>
  );
}
