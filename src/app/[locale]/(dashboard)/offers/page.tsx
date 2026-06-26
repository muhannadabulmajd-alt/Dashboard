import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getOfferOrders, getOffers } from '@/server/db/repositories/offers.repo';
import { getCustomers } from '@/server/db/repositories/customers.repo';
import * as M from '@/lib/metrics';
import { formatMoney, formatNumber } from '@/lib/money';
import { KpiCard } from '@/components/kpi/KpiCard';
import { BarChartCard } from '@/components/charts/Charts';
import { DataTable } from '@/components/data-table/DataTable';
import { PageHeader } from '@/components/ui/primitives';

export default async function OffersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, filters, scope, range } = await getPageContext(params, searchParams, 'view:offers');
  const t = await getTranslations('offers');
  const tc = await getTranslations('common');

  const [offerOrders, offers, customers] = await Promise.all([
    getOfferOrders(filters, scope, range),
    getOffers(),
    getCustomers(scope),
  ]);

  const offersById = new Map(offers.map((o) => [o.id, o] as const));
  const firstOrderById = new Map(customers.map((c) => [c.id, c.firstOrderAt] as const));
  const stats = M.offerPerformance(offerOrders, firstOrderById, range.start, range.end);

  const revenue = stats.reduce((s, x) => s + x.revenue, 0);
  const discount = stats.reduce((s, x) => s + x.discountSpend, 0);
  const now = new Date();
  const activeOffers = offers.filter((offer) => (!offer.startsAt || offer.startsAt <= now) && (!offer.endsAt || offer.endsAt >= now)).length;
  const newCustomers = new Set(offerOrders.flatMap((order) => {
    if (!M.isSalesOrder(order) || !order.customerId) return [];
    const first = firstOrderById.get(order.customerId);
    return first && first >= range.start && first <= range.end ? [order.customerId] : [];
  })).size;

  const revBar = stats.map((s) => ({ label: offersById.get(s.offerId)?.name ?? s.offerId, value: s.revenue }));

  const cols = [
    { label: t('offer') },
    { label: t('code') },
    { label: t('orders'), align: 'end' as const },
    { label: t('revenue'), align: 'end' as const },
    { label: t('discountSpend'), align: 'end' as const },
    { label: t('newCustomers'), align: 'end' as const },
    { label: t('aov'), align: 'end' as const },
  ];
  const rows = stats.map((s) => {
    const offer = offersById.get(s.offerId);
    return [
      offer?.name ?? s.offerId,
      offer?.code ?? '—',
      formatNumber(s.orders, locale),
      formatMoney(s.revenue, 'IQD', locale),
      formatMoney(s.discountSpend, 'IQD', locale),
      formatNumber(s.newCustomers, locale),
      formatMoney(Math.round(s.aov), 'IQD', locale),
    ];
  });

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={t('activeOffers')} value={formatNumber(activeOffers, locale)} locale={locale} />
        <KpiCard label={t('revenue')} value={formatMoney(revenue, 'IQD', locale)} locale={locale} />
        <KpiCard label={t('discountSpend')} value={formatMoney(discount, 'IQD', locale)} locale={locale} invertDelta />
        <KpiCard label={t('newCustomers')} value={formatNumber(newCustomers, locale)} locale={locale} />
      </section>

      <section>
        <BarChartCard title={t('performance')} data={revBar} locale={locale} valueKind="iqd" horizontal />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('performance')}</h3>
        <DataTable columns={cols} rows={rows} emptyLabel={tc('noData')} />
      </section>
    </>
  );
}
