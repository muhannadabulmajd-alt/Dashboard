import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink } from '@/components/records/parts';
import { OrderForm, type OrderLineInput } from '@/components/records/OrderForm';
import { getOrderCatalog } from '@/server/records/order-catalog';
import { getListOptions } from '@/server/lists/resolver';
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
  const [catalog, channels, governorates, fulfillment, statuses, accounts, paymentMethods, financeEntries] = await Promise.all([
    getOrderCatalog(locale, t('ungrouped')),
    getListOptions('channel', locale),
    getListOptions('governorate', locale),
    getListOptions('fulfillment', locale),
    getListOptions('orderStatus', locale),
    prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, currency: true } }),
    getListOptions('paymentMethod', locale),
    prisma.financeEntry.findMany({
      where: { orderId: id, importKey: { startsWith: `ORD:${id}:` }, reversedAt: null, reversalOfId: null },
      select: { importKey: true, obligation: true, accountId: true, dueDate: true, amount: true, paymentMethod: true, date: true },
    }),
  ]);

  const o = await prisma.order.findUnique({
    where: { id },
    include: { customer: { select: { externalId: true } }, lines: { orderBy: { id: 'asc' } } },
  });
  if (!o) notFound();
  const financeAr = financeEntries.find((entry) => entry.importKey === `ORD:${id}:AR`);
  const financePay = financeEntries.find((entry) => entry.importKey === `ORD:${id}:PAY`);
  const financePartial = financeEntries.find((entry) => entry.importKey === `ORD:${id}:PARTIAL`);
  const activeFinance = financePartial ?? financePay ?? financeAr;
  const financeMode = financePartial ? 'PARTIAL' : financePay ? 'PAID' : financeAr ? 'CREDIT' : 'CREDIT';

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
      financeMode,
      financeAccountId: activeFinance?.accountId ?? '',
      financePaidAmount: financePartial ? String(financePartial.amount) : '',
      financePaymentMethod: activeFinance?.paymentMethod ?? '',
      financePaymentDate: activeFinance?.date ? activeFinance.date.toISOString().slice(0, 10) : o.placedAt.toISOString().slice(0, 10),
      financeDueDate: financeAr?.dueDate ? financeAr.dueDate.toISOString().slice(0, 10) : o.placedAt.toISOString().slice(0, 10),
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
    notfound: t('err.notfound'),
  };

  return (
    <>
      <BackLink href={`/admin/records/orders/${id}`} label={t('back')} />
      <PageHeader title={t('editTitle', { entity: t('entities.orders') })} subtitle={o.orderNumber} />
      <OrderForm
        action={updateOrder.bind(null, id)}
        locale={locale}
        channelOptions={channels}
        governorateOptions={governorates}
        fulfillmentOptions={fulfillment}
        statusOptions={statuses}
        accountOptions={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))}
        paymentMethodOptions={paymentMethods}
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
