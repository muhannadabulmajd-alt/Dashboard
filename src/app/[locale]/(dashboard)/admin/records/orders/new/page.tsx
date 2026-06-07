import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { enumLabel, CHANNELS, GOVERNORATES, FULFILLMENT_METHODS, ORDER_STATUSES } from '@/lib/enums';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink } from '@/components/records/parts';
import { OrderForm } from '@/components/records/OrderForm';
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
  const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: enumLabel(v, locale) }));

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
    qty: t('f.qty'),
    unitPrice: t('f.unitPrice'),
    discount: t('f.discount'),
    addLine: t('addLine'),
    removeLine: t('removeLine'),
    create: t('create'),
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
        channelOptions={opts(CHANNELS)}
        governorateOptions={opts(GOVERNORATES)}
        fulfillmentOptions={opts(FULFILLMENT_METHODS)}
        statusOptions={opts(ORDER_STATUSES)}
        labels={labels}
        errors={errors}
        cancelHref="/admin/records/orders"
      />
    </>
  );
}
