import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/dates';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'muted' | 'danger'> = {
  COMPLETED: 'success',
  PENDING: 'warning',
  CANCELLED: 'muted',
  RETURNED: 'danger',
  REFUNDED: 'danger',
};

export default async function OrdersRecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:orders');
  const t = await getTranslations('records');
  const orders = await prisma.order.findMany({
    orderBy: { placedAt: 'desc' },
    include: { customer: true },
  });

  const customerName = (c: typeof orders[number]['customer']) =>
    (locale === 'ar' ? c?.nameAr : c?.nameEn) || c?.nameEn || c?.nameAr || c?.externalId || '—';

  const cols: Column[] = [
    { label: t('f.orderNumber') },
    { label: t('f.date') },
    { label: t('f.customer') },
    { label: t('f.channel') },
    { label: t('f.net'), align: 'end' },
    { label: t('f.status') },
    { label: '', align: 'end' },
  ];

  const rows = orders.map((o) => {
    const net = o.grossAmount - o.discountAmount - o.refundAmount;
    return [
      o.orderNumber,
      formatDate(o.placedAt, locale),
      customerName(o.customer),
      enumLabel(o.channel, locale),
      formatMoney(net, o.currency, locale),
      <Badge key="s" variant={STATUS_VARIANT[o.status] ?? 'muted'}>
        {enumLabel(o.status, locale)}
      </Badge>,
      <Link
        key="o"
        href={`/admin/records/orders/${o.id}`}
        className="font-medium text-primary hover:underline"
      >
        {t('open')}
      </Link>,
    ];
  });

  return (
    <>
      <BackLink href="/admin/records" label={t('back')} />
      <PageHeader title={t('entities.orders')} subtitle={t('total', { n: orders.length })} />
      <DataTable columns={cols} rows={rows} emptyLabel={t('none')} />
    </>
  );
}
