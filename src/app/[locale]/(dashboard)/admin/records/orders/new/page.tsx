import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink } from '@/components/records/parts';
import { OrderForm } from '@/components/records/OrderForm';
import { getOrderCatalog } from '@/server/records/order-catalog';
import { getListOptions } from '@/server/lists/resolver';
import { createOrder } from '@/server/records/orders';

export default async function NewOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:orders');
  const t = await getTranslations('records');
  // Dropdowns come from the managed system lists (§9) — relabels, reordering
  // and user-added values all apply here.
  const [catalog, channels, governorates, fulfillment, statuses] = await Promise.all([
    getOrderCatalog(locale, t('ungrouped')),
    getListOptions('channel', locale),
    getListOptions('governorate', locale),
    getListOptions('fulfillment', locale),
    getListOptions('orderStatus', locale),
  ]);

  const labels = {
    orderNumber: t('f.orderNumber'),
    date: t('f.date'),
    customer: t('f.customer'),
    channel: t('f.channel'),
    governorate: t('f.governorate'),
    fulfillment: t('f.fulfillment'),
    status: t('f.status'),
    deliveryFee: t('f.deliveryFee'),
    deliveryCost: t('f.deliveryCost'),
    items: t('f.items'),
    sku: t('f.sku'),
    variation: t('f.variation'),
    qty: t('f.qty'),
    unitPrice: t('f.unitPrice'),
    discount: t('f.discount'),
    subtotal: t('f.subtotal'),
    total: t('f.total'),
    orderDiscount: t('f.orderDiscount'),
    extraCharges: t('f.extraCharges'),
    notes: t('f.notes'),
    addLine: t('addLine'),
    removeLine: t('removeLine'),
    cancel: t('cancel'),
  };
  const errors = {
    invalid: t('err.invalid'),
    exists: t('err.exists'),
    forbidden: t('err.forbidden'),
    sku: t('err.sku'),
    nolines: t('err.nolines'),
  };

  return (
    <>
      <BackLink href="/admin/records/orders" label={t('back')} />
      <PageHeader title={t('newTitle', { entity: t('entities.orders') })} />
      <OrderForm
        action={createOrder}
        locale={locale}
        channelOptions={channels}
        governorateOptions={governorates}
        fulfillmentOptions={fulfillment}
        statusOptions={statuses}
        labels={labels}
        errors={errors}
        cancelHref="/admin/records/orders"
        submitLabel={t('create')}
        catalog={catalog}
      />
    </>
  );
}
