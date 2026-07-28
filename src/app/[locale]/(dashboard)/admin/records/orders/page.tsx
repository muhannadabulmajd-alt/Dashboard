import { getTranslations } from 'next-intl/server';
import type { Prisma } from '@prisma/client';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { getListOptions, getOrderStatusRoleMap } from '@/server/lists/resolver';
import { formatMoney, formatNumber } from '@/lib/money';
import { activeInvoiceFinanceEntry, groupInvoiceFinanceEntries, invoicePaymentSnapshot } from '@/lib/invoice';
import { PageHeader } from '@/components/ui/primitives';
import { OrdersBulkTable, type BulkOrderRow } from '@/components/records/OrdersBulkTable';
import { RecordsSummary, type SummaryStat } from '@/components/records/Summary';
import { TableToolbar } from '@/components/records/TableToolbar';
import { BackLink } from '@/components/records/parts';
import { SectionGuide } from '@/components/records/SectionGuide';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/dates';
import { Plus } from 'lucide-react';
import { bulkUpdateOrders } from '@/server/records/orders';

const ORDER_SORTS: Record<string, Prisma.OrderOrderByWithRelationInput> = {
  newest: { placedAt: 'desc' },
  oldest: { placedAt: 'asc' },
  amountDesc: { grossAmount: 'desc' },
  amountAsc: { grossAmount: 'asc' },
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
          date: true,
          account: { select: { name: true } },
          party: { select: { name: true, collectsOrderPayments: true } },
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
  const [statusOpts, channels, branches, paymentMethods, accounts] = await Promise.all([
    getListOptions('orderStatus', locale),
    getListOptions('channel', locale),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, nameEn: true, nameAr: true } }),
    getListOptions('paymentMethod', locale),
    prisma.financeAccount.findMany({ where: { isActive: true, currency: 'IQD' }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const paymentStatusOpts = (['PAID', 'UNPAID', 'PARTIAL', 'REFUNDED', 'CANCELED'] as const).map((value) => ({
    value,
    label: ti(`paymentStatus.${value}`),
  }));

  const financeEntriesByOrder = groupInvoiceFinanceEntries(financeEntries);
  const rows = orders.flatMap<BulkOrderRow>((o) => {
    const entries = financeEntriesByOrder.get(o.id) ?? [];
    const payment = invoicePaymentSnapshot(o, entries);
    if (paymentStatusFilter && payment.status !== paymentStatusFilter) return [];
    if (
      paymentMethodFilter &&
      !entries.some((entry) => activeInvoiceFinanceEntry(entry) && entry.paymentMethod === paymentMethodFilter)
    ) return [];
    if (amountMin != null && payment.total < amountMin) return [];
    if (amountMax != null && payment.total > amountMax) return [];
    return [{ id: o.id, orderNumber: o.orderNumber, date: formatDate(o.placedAt, locale), customer: customerName(o.customer), channel: enumLabel(o.channel, locale), total: formatMoney(payment.total, o.currency, locale), totalValue: payment.total, paymentStatus: ti(`paymentStatus.${payment.status}`), status: enumLabel(o.status, locale) }];
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
      <OrdersBulkTable
        rows={rows}
        action={bulkUpdateOrders}
        locale={locale}
        statuses={statusOpts}
        saleStatusValues={saleStatuses}
        accounts={accounts.map((account) => ({ value: account.id, label: account.name }))}
        paymentMethods={paymentMethods}
        labels={{
          selectAll: t('bulk.selectAll'), selected: t.raw('bulk.selected') as string, select: t('bulk.select'), order: t('f.orderNumber'), date: t('f.date'), customer: t('f.customer'), channel: t('f.channel'), total: t('f.total'), payment: ti('payment'), status: t('f.status'), open: t('open'), reviewTotal: t('bulk.reviewTotal'), bulkActions: t('bulk.title'), action: t('bulk.action'), updateStatus: t('bulk.updateStatus'), recordPaid: t('bulk.recordPaid'), assignProvider: t('bulk.assignProvider'), account: t('f.account'), paymentMethod: ti('paymentMethod'), provider: t('bulk.provider'), apply: t('bulk.apply'), success: t('bulk.success'), invalid: t('err.invalid'), forbidden: t('err.forbidden'), notfound: t('err.notfound'), accountError: t('err.account'), receivableError: t('bulk.receivableError'), providerError: t('bulk.providerError'), statusError: t('bulk.statusError'), amount_exceeds_open: t('bulk.amountError'), payment_requiredError: t('err.payment_required'), completionPaymentHint: t('bulk.completionPaymentHint'), completionMode: t('bulk.completionMode'), automaticPayment: t('bulk.automaticPayment'), directPayment: t('bulk.directPayment'), providerCollection: t('bulk.providerCollection'),
        }}
      />
    </>
  );
}
