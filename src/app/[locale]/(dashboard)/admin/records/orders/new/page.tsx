import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink } from '@/components/records/parts';
import { OrderForm } from '@/components/records/OrderForm';
import { getOrderCatalog } from '@/server/records/order-catalog';
import { getListOptions, getOrderStatusRoleMap } from '@/server/lists/resolver';
import { createOrder } from '@/server/records/orders';
import { createCustomerInline } from '@/server/records/customers';
import { dateInputValue } from '@/lib/dates';

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
  const [catalog, channels, governorates, fulfillment, statuses, accounts, paymentMethods, customers, providers, statusRoles] = await Promise.all([
    getOrderCatalog(locale, t('ungrouped')),
    getListOptions('channel', locale),
    getListOptions('governorate', locale),
    getListOptions('fulfillment', locale),
    getListOptions('orderStatus', locale),
    prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, currency: true } }),
    getListOptions('paymentMethod', locale),
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
  const saleStatusValues = [...statusRoles]
    .filter(([, role]) => role === 'SALE')
    .map(([code]) => code);

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
        providerOptions={providers.map((provider) => ({ value: provider.id, label: provider.name }))}
        saleStatusValues={saleStatusValues}
        paymentMethodOptions={paymentMethods}
        labels={labels}
        errors={errors}
        cancelHref="/admin/records/orders"
        submitLabel={t('create')}
        catalog={catalog}
        initial={{
          header: {
            placedAt: dateInputValue(),
            deliveryFee: '0',
            deliveryCost: '0',
            orderDiscount: '0',
            extraCharges: '0',
            status: saleStatusValues[0] ?? statuses[0]?.value ?? 'COMPLETED',
            financeMode: 'AUTO',
          },
          lines: [{ sku: '', quantity: '1', unitGrossPrice: '0', lineDiscount: '0' }],
        }}
        customerOptions={customers.map((customer) => ({
          externalId: customer.externalId!,
          label: `${customer.nameEn || customer.nameAr || customer.phone || customer.externalId} (${customer.externalId})`,
          phone: customer.phone,
        }))}
        inlineCustomerAction={createCustomerInline}
      />
    </>
  );
}
