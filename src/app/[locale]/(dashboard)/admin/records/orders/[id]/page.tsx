import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { FileText } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { RecordActions } from '@/components/records/RecordActions';
import { deleteOrder } from '@/server/records/orders';

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
  const { locale } = await getPageContext(params, searchParams, 'manage:orders');
  const { id } = await params;
  const t = await getTranslations('records');
  const ti = await getTranslations('invoice');

  const o = await prisma.order.findUnique({
    where: { id },
    include: { customer: true, lines: { include: { product: true } } },
  });
  if (!o) notFound();

  const customerName =
    (locale === 'ar' ? o.customer?.nameAr : o.customer?.nameEn) ||
    o.customer?.nameEn ||
    o.customer?.nameAr ||
    o.customer?.externalId ||
    '—';

  const net = o.grossAmount - o.discountAmount - o.refundAmount;

  const items: DetailField[] = [
    { label: t('f.orderNumber'), value: o.orderNumber },
    { label: t('f.date'), value: formatDate(o.placedAt, locale) },
    { label: t('f.customer'), value: customerName },
    { label: t('f.channel'), value: enumLabel(o.channel, locale) },
    { label: t('f.governorate'), value: enumLabel(o.governorate, locale) },
    { label: t('f.fulfillment'), value: enumLabel(o.fulfillmentMethod, locale) },
    {
      label: t('f.status'),
      value: (
        <Badge variant={STATUS_VARIANT[o.status] ?? 'muted'}>{enumLabel(o.status, locale)}</Badge>
      ),
    },
    { label: t('f.gross'), value: formatMoney(o.grossAmount, o.currency, locale) },
    { label: t('f.discount'), value: formatMoney(o.discountAmount, o.currency, locale) },
    { label: t('f.net'), value: formatMoney(net, o.currency, locale) },
    { label: t('f.deliveryFee'), value: formatMoney(o.deliveryFee, o.currency, locale) },
    { label: t('f.deliveryCost'), value: formatMoney(o.deliveryCost, o.currency, locale) },
  ];

  const lineCols: Column[] = [
    { label: t('f.product') },
    { label: t('f.qty'), align: 'end' },
    { label: t('f.unitPrice'), align: 'end' },
    { label: t('f.lineTotal'), align: 'end' },
  ];

  const lineRows = o.lines.map((l) => [
    `${l.sku} — ${locale === 'ar' ? l.product.nameAr : l.product.nameEn}`,
    l.quantity,
    formatMoney(l.unitGrossPrice, o.currency, locale),
    formatMoney(l.lineNet, o.currency, locale),
  ]);

  return (
    <>
      <BackLink href="/admin/records/orders" label={t('back')} />
      <PageHeader title={o.orderNumber} subtitle={formatDate(o.placedAt, locale)} />
      <div className="flex flex-wrap items-center gap-2">
        <RecordActions
          editHref={`/admin/records/orders/${o.id}/edit`}
          deleteAction={deleteOrder.bind(null, o.id, locale)}
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
    </>
  );
}
