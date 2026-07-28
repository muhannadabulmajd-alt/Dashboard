import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink } from '@/components/records/parts';
import { OrderForm, type OrderLineInput } from '@/components/records/OrderForm';
import { getOrderCatalog } from '@/server/records/order-catalog';
import { getListOptions, getOrderStatusRoleMap } from '@/server/lists/resolver';
import { updateOrder } from '@/server/records/orders';
import { createCustomerInline } from '@/server/records/customers';
import { invoicePaymentSnapshot } from '@/lib/invoice';

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
  const ti = await getTranslations('invoice');
  const [catalog, channels, governorates, fulfillment, statuses, accounts, paymentMethods, financeEntries, customers, providers, statusRoles] = await Promise.all([
    getOrderCatalog(locale, t('ungrouped')),
    getListOptions('channel', locale),
    getListOptions('governorate', locale),
    getListOptions('fulfillment', locale),
    getListOptions('orderStatus', locale),
    prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, currency: true } }),
    getListOptions('paymentMethod', locale),
    prisma.financeEntry.findMany({
      where: { OR: [{ orderId: id }, { settles: { is: { orderId: id } } }] },
      select: {
        id: true,
        orderId: true,
        importKey: true,
        type: true,
        amount: true,
        obligation: true,
        obligationKind: true,
        settlesId: true,
        accountId: true,
        dueDate: true,
        paymentMethod: true,
        date: true,
        archivedAt: true,
        reversedAt: true,
        reversalOfId: true,
        account: { select: { name: true } },
        party: { select: { id: true, name: true, collectsOrderPayments: true } },
      },
    }),
    prisma.customer.findMany({
      where: { isActive: true, externalId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { externalId: true, nameEn: true, nameAr: true, phone: true },
    }),
    prisma.party.findMany({
      where: { isActive: true, collectsOrderPayments: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    getOrderStatusRoleMap(),
  ]);

  const o = await prisma.order.findUnique({
    where: { id },
    include: { customer: { select: { externalId: true } }, lines: { orderBy: { id: 'asc' } } },
  });
  if (!o) notFound();
  const payment = invoicePaymentSnapshot(o, financeEntries);
  const financeAr = financeEntries.find((entry) => payment.receivableIds.includes(entry.id));
  const saleStatusValues = [...statusRoles]
    .filter(([, role]) => role === 'SALE')
    .map(([code]) => code);

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
      financeMode: 'KEEP',
      financeAccountId: '',
      financeProviderId: payment.providerPartyId ?? '',
      financePaidAmount: '',
      financePaymentMethod: payment.paymentMethod ?? '',
      financePaymentDate: payment.paymentDate ? payment.paymentDate.toISOString().slice(0, 10) : o.placedAt.toISOString().slice(0, 10),
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
    orderNumberGenerated: t('orderForm.orderNumberGenerated'),
    searchCustomer: t('orderForm.searchCustomer'),
    selectCustomer: t('orderForm.selectCustomer'),
    customerPickerTitle: t('orderForm.customerPickerTitle'),
    customerPickerHint: t('orderForm.customerPickerHint'),
    clearCustomer: t('orderForm.clearCustomer'),
    noCustomersFound: t('orderForm.noCustomersFound'),
    done: t('orderForm.done'),
    createCustomer: t('orderForm.createCustomer'),
    saving: t('create'),
    customerName: t('f.name'),
    customerPhone: t('f.phone'),
    customerEmail: t('f.email'),
    customerAddress: t('f.address1'),
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
    financeAuto: t('f.financeAuto'),
    financeCredit: t('f.financeCredit'),
    financePaid: t('f.financePaid'),
    financePartial: t('f.financePartial'),
    financeProvider: t('f.financeProvider'),
    financeNone: t('f.financeNone'),
    financePaidAmount: t('f.financePaidAmount'),
    paymentAccount: t('f.paymentAccount'),
    paymentMethod: t('f.paymentMethod'),
    paymentDate: t('f.paymentDate'),
    paymentDueDate: t('f.paymentDueDate'),
    provider: t('f.provider'),
    paid: t('f.paid'),
    remaining: t('f.remaining'),
    paymentStatus: t('f.paymentStatus'),
    paymentRoute: t('f.paymentRoute'),
    providerOutstanding: t('f.providerOutstanding'),
    paymentReadOnlyHint: t('orderForm.paymentReadOnlyHint'),
    choosePaymentRoute: t('orderForm.choosePaymentRoute'),
    completionPaymentHint: t('orderForm.completionPaymentHint'),
    scanBarcode: t('orderForm.scanBarcode'),
    scanBarcodeHint: t('orderForm.scanBarcodeHint'),
    addScannedItem: t('orderForm.addScannedItem'),
    scanAdded: t('orderForm.scanAdded'),
    scanNotFound: t('orderForm.scanNotFound'),
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
    date: t('err.date'),
    quantity: t('err.quantity'),
    price: t('err.price'),
    account: t('err.account'),
    partial: t('err.partial'),
    customer: t('err.customer'),
    create_failed: t('err.create_failed'),
    order_create_failed: t('err.order_create_failed'),
    stock_sync_failed: t('err.stock_sync_failed'),
    finance_sync_failed: t('err.finance_sync_failed'),
    customer_stats_failed: t('err.customer_stats_failed'),
    notfound: t('err.notfound'),
    provider: t('err.provider'),
    payment_required: t('err.payment_required'),
    payment_read_only: t('err.payment_read_only'),
    payment_exceeds_total: t('err.payment_exceeds_total'),
    refund_required: t('err.refund_required'),
    order_update_failed: t('err.order_update_failed'),
    finance_configuration: t('err.finance_configuration'),
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
        providerOptions={providers.map((provider) => ({ value: provider.id, label: provider.name }))}
        saleStatusValues={saleStatusValues}
        paymentMethodOptions={paymentMethods}
        labels={labels}
        errors={errors}
        cancelHref={`/admin/records/orders/${id}`}
        initial={initial}
        submitLabel={t('save')}
        editing
        catalog={catalog}
        customerOptions={customers.map((customer) => ({
          externalId: customer.externalId!,
          label: `${customer.nameEn || customer.nameAr || customer.phone || customer.externalId} (${customer.externalId})`,
          phone: customer.phone,
        }))}
        inlineCustomerAction={createCustomerInline}
        paymentSummary={{
          total: payment.total,
          paid: payment.paid,
          remaining: payment.remaining,
          status: payment.status,
          statusLabel: ti(`paymentStatus.${payment.status}`),
          route: payment.route,
          routeLabel: ti(`route.${payment.route}`),
          providerName: payment.providerName,
          providerOutstanding: payment.providerOutstanding,
        }}
      />
    </>
  );
}
