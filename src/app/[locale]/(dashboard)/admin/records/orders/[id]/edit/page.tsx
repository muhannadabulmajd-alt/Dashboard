import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { enumLabel, CHANNELS, GOVERNORATES, FULFILLMENT_METHODS, ORDER_STATUSES } from '@/lib/enums';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink } from '@/components/records/parts';
import { OrderForm, type OrderLineInput } from '@/components/records/OrderForm';
import { getOrderCatalog } from '@/server/records/order-catalog';
import { updateOrder } from '@/server/records/orders';

export default async function EditOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:orders');
  const { id } = await params;
  const t = await getTranslations('records');
  const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: enumLabel(v, locale) }));
  const catalog = await getOrderCatalog(locale, t('ungrouped'));

  const o = await prisma.order.findUnique({
    where: { id },
    include: { customer: { select: { externalId: true } }, lines: { orderBy: { id: 'asc' } } },
  });
  if (!o) notFound();

  const initial = {
    header: {
      orderNumber: o.orderNumber,
      placedAt: o.placedAt.toISOString().slice(0, 10),
      customerExternalId: o.customer?.externalId ?? '',
      channel: o.channel,
      governorate: o.governorate,
      fulfillmentMethod: o.fulfillmentMethod,
      status: o.status,
      deliveryFee: String(o.deliveryFee),
      deliveryCost: String(o.deliveryCost),
      orderDiscount: String(o.orderDiscount),
      extraCharges: String(o.extraCharges),
      notes: o.notes ?? '',
    },
    lines: o.lines.map(
      (l): OrderLineInput => ({
        sku: l.sku,
        quantity: String(l.quantity),
        unitGrossPrice: String(l.unitGrossPrice),
        lineDiscount: String(l.lineDiscount),
      }),
    ),
  };

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
    notfound: t('err.notfound'),
  };

  return (
    <>
      <BackLink href={`/admin/records/orders/${id}`} label={t('back')} />
      <PageHeader title={t('editTitle', { entity: t('entities.orders') })} subtitle={o.orderNumber} />
      <OrderForm
        action={updateOrder.bind(null, id)}
        locale={locale}
        channelOptions={opts(CHANNELS)}
        governorateOptions={opts(GOVERNORATES)}
        fulfillmentOptions={opts(FULFILLMENT_METHODS)}
        statusOptions={opts(ORDER_STATUSES)}
        labels={labels}
        errors={errors}
        cancelHref={`/admin/records/orders/${id}`}
        initial={initial}
        submitLabel={t('save')}
        editing
        catalog={catalog}
      />
    </>
  );
}
