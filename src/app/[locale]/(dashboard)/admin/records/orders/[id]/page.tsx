import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { FileText } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { dateInputValue, formatDate } from '@/lib/dates';
import { activeInvoiceFinanceEntry, invoicePaymentSnapshot } from '@/lib/invoice';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { RecordActions } from '@/components/records/RecordActions';
import { deleteOrder } from '@/server/records/orders';
import { Link } from '@/i18n/navigation';
import { orderWhereForScope, resolveLocationObjectScope } from '@/server/inventory-v2/object-scope';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import { can } from '@/lib/rbac';
import { OrderReturnToQuarantineForm } from '@/components/records/ReturnedGoodsForms';
import { returnFinishedGoodsToQuarantineAction } from '@/server/inventory-v2/operations-actions';
import { getOrderReturnOptions } from '@/server/inventory-v2/operations-read';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'muted' | 'danger'> = {
  COMPLETED: 'success',
  PENDING: 'warning',
  CANCELLED: 'muted',
  RETURNED: 'danger',
  REFUNDED: 'danger',
};

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'manage:orders');
  const { id } = await params;
  const t = await getTranslations('records');
  const ti = await getTranslations('invoice');
  const inventoryV2Enabled = getInventoryV2Config().enabled;

  const objectScope = await resolveLocationObjectScope(user);
  const o = await prisma.order.findFirst({
    where: { id, ...orderWhereForScope(objectScope) },
    include: {
      customer: true,
      fulfillmentLocation: { include: { branch: true } },
      lines: { include: { product: true } },
    },
  });
  if (!o) notFound();
  const returnOptions = inventoryV2Enabled && can(user.role, 'manage:inventory')
    ? await getOrderReturnOptions(user, o.id)
    : null;
  const financeEntries = await prisma.financeEntry.findMany({
    where: { OR: [{ orderId: id }, { settles: { is: { orderId: id } } }] },
    include: {
      account: { select: { name: true } },
      party: { select: { id: true, name: true, collectsOrderPayments: true } },
      settles: { select: { id: true, reference: true } },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  const payment = invoicePaymentSnapshot(o, financeEntries);

  const customerName =
    (locale === 'ar' ? o.customer?.nameAr : o.customer?.nameEn) ||
    o.customer?.nameEn ||
    o.customer?.nameAr ||
    o.customer?.externalId ||
    '—';

  const items: DetailField[] = [
    { label: t('f.orderNumber'), value: o.orderNumber },
    { label: t('f.date'), value: formatDate(o.placedAt, locale) },
    { label: t('f.customer'), value: customerName },
    { label: t('f.channel'), value: enumLabel(o.channel, locale) },
    { label: t('f.governorate'), value: enumLabel(o.governorate, locale) },
    { label: t('f.fulfillment'), value: enumLabel(o.fulfillmentMethod, locale) },
    ...(o.fulfillmentLocation
      ? [{
          label: t('orderForm.fulfillmentLocation'),
          value: locale === 'ar'
            ? `${o.fulfillmentLocation.nameAr} · ${o.fulfillmentLocation.branch.nameAr}`
            : `${o.fulfillmentLocation.nameEn} · ${o.fulfillmentLocation.branch.nameEn}`,
        }]
      : []),
    {
      label: t('f.status'),
      value: (
        <Badge variant={STATUS_VARIANT[o.status] ?? 'muted'}>{enumLabel(o.status, locale)}</Badge>
      ),
    },
    { label: t('f.gross'), value: formatMoney(o.grossAmount, o.currency, locale) },
    { label: t('f.discount'), value: formatMoney(o.discountAmount, o.currency, locale) },
    ...(o.extraCharges ? [{ label: t('f.extraCharges'), value: formatMoney(o.extraCharges, o.currency, locale) }] : []),
    { label: t('f.deliveryFee'), value: formatMoney(o.deliveryFee, o.currency, locale) },
    { label: t('f.deliveryCost'), value: formatMoney(o.deliveryCost, o.currency, locale) },
    { label: t('f.total'), value: formatMoney(payment.total, o.currency, locale) },
    {
      label: ti('paymentStatusLabel'),
      value: (
        <Badge variant={payment.status === 'PAID' ? 'success' : payment.status === 'PARTIAL' ? 'warning' : 'danger'}>
          {ti(`paymentStatus.${payment.status}`)}
        </Badge>
      ),
    },
    { label: ti('paid'), value: formatMoney(payment.paid, o.currency, locale) },
    { label: ti('remaining'), value: formatMoney(payment.remaining, o.currency, locale) },
    { label: ti('paymentRoute'), value: ti(`route.${payment.route}`) },
    ...(payment.paymentMethod
      ? [{ label: ti('paymentMethod'), value: enumLabel(payment.paymentMethod, locale) }]
      : []),
    ...(payment.accountName ? [{ label: ti('account'), value: payment.accountName }] : []),
    ...(payment.paymentDate
      ? [{ label: ti('paymentDate'), value: formatDate(payment.paymentDate, locale) }]
      : []),
    ...(payment.providerName
      ? [{ label: ti('provider'), value: payment.providerName }]
      : []),
    ...(payment.providerCollected > 0
      ? [
          { label: ti('providerCollected'), value: formatMoney(payment.providerCollected, o.currency, locale) },
          { label: ti('providerRemitted'), value: formatMoney(payment.providerRemitted, o.currency, locale) },
          { label: ti('providerFeesOffset'), value: formatMoney(payment.providerFeesOffset, o.currency, locale) },
          { label: ti('providerOutstanding'), value: formatMoney(payment.providerOutstanding, o.currency, locale) },
        ]
      : []),
    ...(o.notes ? [{ label: t('f.notes'), value: o.notes }] : []),
  ];

  const lineCols: Column[] = [
    { label: t('f.product') },
    { label: t('f.unit') },
    { label: t('f.qty'), align: 'end' },
    { label: t('f.unitPrice'), align: 'end' },
    { label: t('f.lineTotal'), align: 'end' },
  ];

  const lineRows = o.lines.map((l) => [
    `${l.sku} — ${locale === 'ar' ? l.product.nameAr : l.product.nameEn}`,
    l.unitLabel,
    l.quantity,
    formatMoney(l.unitGrossPrice, o.currency, locale),
    formatMoney(l.lineNet, o.currency, locale),
  ]);
  const financeRows = financeEntries
    .filter(activeInvoiceFinanceEntry)
    .map((entry) => [
      formatDate(entry.date, locale),
      entry.obligation && entry.party?.collectsOrderPayments
        ? ti('providerCollection')
        : entry.obligation
          ? ti('customerCredit')
          : enumLabel(entry.type, locale),
      entry.party?.name ?? '—',
      entry.account?.name ?? '—',
      formatMoney(entry.amount, entry.currency, locale),
      <Link key={entry.id} href={`/finance/ledger/${entry.id}`} className="font-semibold text-primary hover:underline">
        {t('open')}
      </Link>,
    ]);

  return (
    <>
      <BackLink href="/admin/records/orders" label={t('back')} />
      <PageHeader title={o.orderNumber} subtitle={formatDate(o.placedAt, locale)} />
      <div className="flex flex-wrap items-center gap-2">
        <RecordActions
          editHref={`/admin/records/orders/${o.id}/edit`}
          deleteAction={inventoryV2Enabled ? undefined : deleteOrder.bind(null, o.id, locale)}
          labels={{
            edit: t('edit'),
            archive: t('archive'),
            restore: t('restore'),
            delete: t('delete'),
            confirm: t('confirmDelete'),
          }}
        />
        <a
          href={`/${locale}/invoice/${o.id}`}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          <FileText className="size-3.5" />
          {ti('title')}
        </a>
      </div>
      <DetailGrid items={items} />
      <div className="mt-4 space-y-2">
        <h3 className="text-sm font-semibold">{t('f.items')}</h3>
        <DataTable columns={lineCols} rows={lineRows} emptyLabel={t('none')} />
      </div>
      {returnOptions?.lines.length ? (
        <div className="mt-4 space-y-2">
          <div>
            <h3 className="text-sm font-semibold">{t('inventoryV2.operations.returnToQuarantine')}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t('inventoryV2.operations.returnToQuarantineHint')}</p>
          </div>
          <OrderReturnToQuarantineForm
            action={returnFinishedGoodsToQuarantineAction}
            locale={locale}
            idempotencyKey={`return-to-quarantine:${randomUUID()}`}
            occurredAt={dateInputValue()}
            expectedFulfillmentVersion={returnOptions.order.fulfillmentLocation!.stockVersion}
            expectedQuarantineVersion={returnOptions.quarantine.stockVersion}
            lines={returnOptions.lines.map((line) => ({
              orderLineId: line.orderLineId,
              label: `${line.sku} · ${locale === 'ar' ? line.nameAr : line.nameEn}`,
              returnableQuantity: line.returnableQuantity,
            }))}
            labels={{
              item: t('inventoryV2.operations.item'),
              quantity: t('inventoryV2.operations.quantity'),
              returnable: t('inventoryV2.operations.returnable'),
              date: t('inventoryV2.operations.date'),
              reason: t('inventoryV2.operations.reason'),
              submit: t('inventoryV2.operations.moveToQuarantine'),
            }}
            errors={{
              invalid_input: t('inventoryV2.operations.invalid'),
              invalid_date: t('inventoryV2.operations.invalid'),
              forbidden: t('inventoryV2.operations.forbidden'),
              location_receive_forbidden: t('inventoryV2.operations.forbidden'),
              location_stale: t('inventoryV2.operations.stale'),
              return_exceeds_sold_quantity: t('inventoryV2.operations.returnExceedsSold'),
              quarantine_location_missing: t('inventoryV2.operations.quarantineMissing'),
              return_inventory_link_ambiguous: t('inventoryV2.operations.returnInventoryAmbiguous'),
            }}
          />
        </div>
      ) : null}
      <div className="mt-4 space-y-2">
        <div>
          <h3 className="text-sm font-semibold">{ti('financeHistory')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{ti('financeHistoryHint')}</p>
        </div>
        <DataTable
          columns={[
            { label: ti('date') },
            { label: ti('payment') },
            { label: ti('provider') },
            { label: ti('account') },
            { label: ti('amount'), align: 'end' },
            { label: t('open') },
          ]}
          rows={financeRows}
          emptyLabel={ti('noFinanceRecords')}
        />
      </div>
    </>
  );
}
