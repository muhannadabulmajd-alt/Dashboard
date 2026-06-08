import { getTranslations } from 'next-intl/server';
import type { Prisma, OrderStatus } from '@prisma/client';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel, ORDER_STATUSES } from '@/lib/enums';
import { formatMoney, formatNumber } from '@/lib/money';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { RecordsSummary, type SummaryStat } from '@/components/records/Summary';
import { TableToolbar } from '@/components/records/TableToolbar';
import { BackLink } from '@/components/records/parts';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/dates';
import { Plus } from 'lucide-react';

const ORDER_SORTS: Record<string, Prisma.OrderOrderByWithRelationInput> = {
  newest: { placedAt: 'desc' },
  oldest: { placedAt: 'asc' },
  amountDesc: { grossAmount: 'desc' },
  amountAsc: { grossAmount: 'asc' },
};

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
  const ti = await getTranslations('invoice');
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const statusFilter = typeof sp.status === 'string' ? sp.status : '';
  const sort = typeof sp.sort === 'string' ? sp.sort : '';

  const where: Prisma.OrderWhereInput = {
    AND: [
      q
        ? {
            OR: [
              { orderNumber: { contains: q, mode: 'insensitive' } },
              {
                customer: {
                  OR: [
                    { nameEn: { contains: q, mode: 'insensitive' } },
                    { nameAr: { contains: q, mode: 'insensitive' } },
                    { externalId: { contains: q, mode: 'insensitive' } },
                    { phone: { contains: q, mode: 'insensitive' } },
                  ],
                },
              },
            ],
          }
        : {},
      statusFilter ? { status: statusFilter as OrderStatus } : {},
    ],
  };

  // Summary covers ALL orders (independent of the table filter) via aggregates.
  const [grouped, revenueAgg, total, orders] = await Promise.all([
    prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.order.aggregate({
      where: { status: { notIn: ['CANCELLED', 'PENDING'] } },
      _sum: { grossAmount: true, discountAmount: true, refundAmount: true },
    }),
    prisma.order.count(),
    prisma.order.findMany({ where, orderBy: ORDER_SORTS[sort] ?? ORDER_SORTS.newest, include: { customer: true }, take: 500 }),
  ]);

  const customerName = (c: typeof orders[number]['customer']) =>
    (locale === 'ar' ? c?.nameAr : c?.nameEn) || c?.nameEn || c?.nameAr || c?.externalId || '—';

  const statusCount = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;
  const netRevenue =
    (revenueAgg._sum.grossAmount ?? 0) - (revenueAgg._sum.discountAmount ?? 0) - (revenueAgg._sum.refundAmount ?? 0);
  const stats: SummaryStat[] = [
    { label: t('k.total'), value: formatNumber(total, locale) },
    { label: enumLabel('COMPLETED', locale), value: formatNumber(statusCount('COMPLETED'), locale), tone: 'success' },
    { label: enumLabel('PENDING', locale), value: formatNumber(statusCount('PENDING'), locale), tone: 'warning' },
    { label: enumLabel('CANCELLED', locale), value: formatNumber(statusCount('CANCELLED'), locale), tone: 'danger' },
    { label: t('k.revenue'), value: formatMoney(netRevenue, 'IQD', locale) },
  ];

  const sortOpts = ['newest', 'oldest', 'amountDesc', 'amountAsc'].map((v) => ({ value: v, label: t(`tools.${v}`) }));
  const statusOpts = ORDER_STATUSES.map((s) => ({ value: s, label: enumLabel(s, locale) }));

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
      <span key="a" className="flex items-center justify-end gap-3">
        <a
          href={`/${locale}/invoice/${o.id}?print=1`}
          target="_blank"
          rel="noopener"
          className="font-medium text-primary hover:underline"
        >
          {ti('title')}
        </a>
        <Link href={`/admin/records/orders/${o.id}`} className="font-medium text-primary hover:underline">
          {t('open')}
        </Link>
      </span>,
    ];
  });

  return (
    <>
      <BackLink href="/admin/records" label={t('back')} />
      <div className="flex items-center justify-between gap-3">
        <PageHeader title={t('entities.orders')} subtitle={t('total', { n: orders.length })} />
        <Link
          href="/admin/records/orders/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
        >
          <Plus className="size-4" />
          {t('add')}
        </Link>
      </div>
      <RecordsSummary stats={stats} />
      <TableToolbar
        searchPlaceholder={t('tools.search')}
        filters={[{ name: 'status', label: t('f.status'), options: statusOpts }]}
        sorts={sortOpts}
        sortLabel={t('tools.sort')}
      />
      <DataTable columns={cols} rows={rows} emptyLabel={t('none')} />
    </>
  );
}
