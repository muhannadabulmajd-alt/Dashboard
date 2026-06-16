import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
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
  const [catalog, channels, governorates, fulfillment, statuses, accounts, paymentMethods] = await Promise.all([
    getOrderCatalog(locale, t('ungrouped')),
    getListOptions('channel', locale),
    getListOptions('governorate', locale),
    getListOptions('fulfillment', locale),
    getListOptions('orderStatus', locale),
    prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, currency: true } }),
    getListOptions('paymentMethod', locale),
  ]);

  const labels = {
    detailsTitle: t('orderForm.detailsTitle'),
    detailsHint: t('orderForm.detailsHint'),
    orderNumber: t('f.orderNumber'),
    date: t('f.date'),
    customer: t('f.customer'),
    customerHint: t('orderForm.customerHint'),
    newCustomer: t('orderForm.newCustomer'),
    channel: t('f.channel'),
    governorate: t('f.governorate'),
    fulfillment: t('f.fulfillment'),
    status: t('f.status'),
    deliveryFee: t('f.deliveryFee'),
    deliveryCost: t('f.deliveryCost'),
    items: t('f.items'),
    sku: t('f.sku'),
    variation: t('f.variation'),
    unit: t('f.unit'),
    qty: t('f.qty'),
    unitPrice: t('f.unitPrice'),
    discount: t('f.discount'),
    subtotal: t('f.subtotal'),
    total: t('f.total'),
    orderDiscount: t('f.orderDiscount'),
    extraCharges: t('f.extraCharges'),
    notes: t('f.notes'),
    paymentTitle: t('orderForm.paymentTitle'),
    paymentHint: t('orderForm.paymentHint'),
    financeMode: t('f.financeMode'),
    financeCredit: t('f.financeCredit'),
    financePaid: t('f.financePaid'),
    financePartial: t('f.financePartial'),
    financeNone: t('f.financeNone'),
    financePaidAmount: t('f.financePaidAmount'),
    paymentAccount: t('f.paymentAccount'),
    paymentMethod: t('f.paymentMethod'),
    paymentDate: t('f.paymentDate'),
    paymentDueDate: t('f.paymentDueDate'),
    addLine: t('addLine'),
    removeLine: t('removeLine'),
    itemsHint: t('orderForm.itemsHint'),
    reviewTitle: t('orderForm.reviewTitle'),
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
        accountOptions={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))}
        paymentMethodOptions={paymentMethods}
        labels={labels}
        errors={errors}
        cancelHref="/admin/records/orders"
        submitLabel={t('create')}
        catalog={catalog}
      />
    </>
  );
}
