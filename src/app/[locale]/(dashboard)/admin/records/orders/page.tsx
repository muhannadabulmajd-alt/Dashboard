import { getTranslations } from 'next-intl/server';
import type { Prisma } from '@prisma/client';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { getListOptions, getOrderStatusRoleMap } from '@/server/lists/resolver';
import { formatMoney, formatNumber } from '@/lib/money';
import { invoicePaymentSnapshot, type InvoicePaymentStatus } from '@/lib/invoice';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { RecordsSummary, type SummaryStat } from '@/components/records/Summary';
import { TableToolbar } from '@/components/records/TableToolbar';
import { BackLink } from '@/components/records/parts';
import { SectionGuide } from '@/components/records/SectionGuide';
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

function paymentVariant(status: InvoicePaymentStatus): 'success' | 'warning' | 'muted' | 'danger' {
  if (status === 'PAID') return 'success';
  if (status === 'PARTIAL') return 'warning';
  if (status === 'REFUNDED' || status === 'CANCELED') return 'danger';
  return 'muted';
}

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
  const tf = await getTranslations('filters');
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const statusFilter = typeof sp.status === 'string' ? sp.status : '';
  const channelFilter = typeof sp.channel === 'string' ? sp.channel : '';
  const branchFilter = typeof sp.branchId === 'string' ? sp.branchId : '';
  const paymentStatusFilter = typeof sp.paymentStatus === 'string' ? sp.paymentStatus : '';
  const paymentMethodFilter = typeof sp.paymentMethod === 'string' ? sp.paymentMethod : '';
  const from = typeof sp.from === 'string' ? sp.from : '';
  const to = typeof sp.to === 'string' ? sp.to : '';
  const amountMin = typeof sp.amountMin === 'string' && sp.amountMin ? Number(sp.amountMin) : null;
  const amountMax = typeof sp.amountMax === 'string' && sp.amountMax ? Number(sp.amountMax) : null;
  const sort = typeof sp.sort === 'string' ? sp.sort : '';

  const where: Prisma.OrderWhereInput = {
    AND: [
      q
        ? {
            OR: [
              { orderNumber: { contains: q, mode: 'insensitive' } },
              {
                lines: {
                  some: {
                    OR: [
                      { sku: { contains: q, mode: 'insensitive' } },
                      { product: { nameEn: { contains: q, mode: 'insensitive' } } },
                      { product: { nameAr: { contains: q, mode: 'insensitive' } } },
                    ],
                  },
                },
              },
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
      statusFilter ? { status: statusFilter } : {},
      channelFilter ? { channel: channelFilter } : {},
      branchFilter ? { branchId: branchFilter } : {},
      from ? { placedAt: { gte: new Date(`${from}T00:00:00.000`) } } : {},
      to ? { placedAt: { lte: new Date(`${to}T23:59:59.999`) } } : {},
    ],
  };

  const statusRoles = await getOrderStatusRoleMap();
  const saleStatuses = [...statusRoles].filter(([, role]) => role === 'SALE').map(([code]) => code);

  // Summary covers all orders and follows the managed status-role contract.
  const [grouped, revenueAgg, total, orders] = await Promise.all([
    prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.order.aggregate({
      where: { status: { in: saleStatuses } },
      _sum: { grossAmount: true, discountAmount: true, refundAmount: true },
    }),
    prisma.order.count(),
    prisma.order.findMany({ where, orderBy: ORDER_SORTS[sort] ?? ORDER_SORTS.newest, include: { customer: true }, take: 500 }),
  ]);
  const orderIds = orders.map((order) => order.id);
  const financeEntries = orderIds.length
    ? await prisma.financeEntry.findMany({
        where: {
          OR: [{ orderId: { in: orderIds } }, { settles: { is: { orderId: { in: orderIds } } } }],
        },
        select: {
          id: true,
          orderId: true,
          type: true,
          amount: true,
          obligation: true,
          obligationKind: true,
          settlesId: true,
          paymentMethod: true,
          archivedAt: true,
          reversedAt: true,
          reversalOfId: true,
        },
      })
    : [];

  const customerName = (c: typeof orders[number]['customer']) =>
    (locale === 'ar' ? c?.nameAr : c?.nameEn) || c?.nameEn || c?.nameAr || c?.externalId || '—';

  const roleCount = (role: 'OPEN' | 'SALE' | 'RETURN' | 'CANCELED') => grouped.reduce(
    (sum, group) => sum + (statusRoles.get(group.status) === role ? group._count._all : 0),
    0,
  );
  const netRevenue =
    (revenueAgg._sum.grossAmount ?? 0) - (revenueAgg._sum.discountAmount ?? 0) - (revenueAgg._sum.refundAmount ?? 0);
  const stats: SummaryStat[] = [
    { label: t('k.total'), value: formatNumber(total, locale) },
    { label: enumLabel('COMPLETED', locale), value: formatNumber(roleCount('SALE'), locale), tone: 'success' },
    { label: enumLabel('PENDING', locale), value: formatNumber(roleCount('OPEN'), locale), tone: 'warning' },
    { label: enumLabel('CANCELLED', locale), value: formatNumber(roleCount('CANCELED'), locale), tone: 'danger' },
    { label: t('k.revenue'), value: formatMoney(netRevenue, 'IQD', locale) },
  ];

  const sortOpts = ['newest', 'oldest', 'amountDesc', 'amountAsc'].map((v) => ({ value: v, label: t(`tools.${v}`) }));
  const [statusOpts, channels, branches, paymentMethods] = await Promise.all([
    getListOptions('orderStatus', locale),
    getListOptions('channel', locale),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, nameEn: true, nameAr: true } }),
    getListOptions('paymentMethod', locale),
  ]);
  const paymentStatusOpts = (['PAID', 'UNPAID', 'PARTIAL', 'REFUNDED', 'CANCELED'] as const).map((value) => ({
    value,
    label: ti(`paymentStatus.${value}`),
  }));

  const cols: Column[] = [
    { label: t('f.orderNumber') },
    { label: t('f.date') },
    { label: t('f.customer') },
    { label: t('f.channel') },
    { label: t('f.total'), align: 'end' },
    { label: ti('payment'), align: 'end' },
    { label: t('f.status') },
    { label: '', align: 'end' },
  ];

  const rows = orders.flatMap((o) => {
    const entries = financeEntries.filter((entry) => entry.orderId === o.id || (entry.settlesId && financeEntries.some((base) => base.id === entry.settlesId && base.orderId === o.id)));
    const payment = invoicePaymentSnapshot(o, entries);
    if (paymentStatusFilter && payment.status !== paymentStatusFilter) return [];
    if (paymentMethodFilter && !entries.some((entry) => entry.paymentMethod === paymentMethodFilter)) return [];
    if (amountMin != null && payment.total < amountMin) return [];
    if (amountMax != null && payment.total > amountMax) return [];
    return [
      [
        o.orderNumber,
        formatDate(o.placedAt, locale),
        customerName(o.customer),
        enumLabel(o.channel, locale),
        formatMoney(payment.total, o.currency, locale),
        <Badge key="p" variant={paymentVariant(payment.status)}>{ti(`paymentStatus.${payment.status}`)}</Badge>,
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
      ],
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
      <SectionGuide title={t('guide.orders.title')} intro={t('guide.orders.intro')} points={t.raw('guide.orders.points') as string[]} />
      <RecordsSummary stats={stats} />
      <TableToolbar
        searchPlaceholder={t('tools.search')}
        filters={[
          { name: 'status', label: t('f.status'), options: statusOpts },
          { name: 'channel', label: t('f.channel'), options: channels },
          { name: 'branchId', label: t('f.branch'), options: branches.map((b) => ({ value: b.id, label: `${b.code} · ${locale === 'ar' ? b.nameAr : b.nameEn}` })) },
          { name: 'paymentStatus', label: ti('paymentStatusLabel'), options: paymentStatusOpts },
          { name: 'paymentMethod', label: ti('paymentMethod'), options: paymentMethods },
        ]}
        inputs={[
          { name: 'from', label: tf('from'), type: 'date' },
          { name: 'to', label: tf('to'), type: 'date' },
          { name: 'amountMin', label: ti('amountMin'), type: 'number' },
          { name: 'amountMax', label: ti('amountMax'), type: 'number' },
        ]}
        sorts={sortOpts}
        sortLabel={t('tools.sort')}
      />
      <DataTable columns={cols} rows={rows} emptyLabel={t('none')} />
    </>
  );
}
