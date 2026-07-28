import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { RecordsSummary, type SummaryStat } from '@/components/records/Summary';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { RecordActions } from '@/components/records/RecordActions';
import { archiveCustomer, deleteCustomer } from '@/server/records/customers';
import { formatDate } from '@/lib/dates';
import { formatMoney, formatNumber } from '@/lib/money';
import { invoiceTotal } from '@/lib/invoice';
import { Link } from '@/i18n/navigation';
import { getOrderStatusRoleMap } from '@/server/lists/resolver';

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:customers');
  const { id } = await params;
  const t = await getTranslations('records');
  const statusRoles = await getOrderStatusRoleMap();
  const saleStatuses = [...statusRoles].filter(([, role]) => role === 'SALE').map(([code]) => code);
  const [c, spendOrders] = await Promise.all([
    prisma.customer.findUnique({
      where: { id },
      include: {
        orders: {
          where: { status: { in: saleStatuses }, purpose: 'SALE' },
          orderBy: { placedAt: 'desc' },
          take: 12,
          include: { lines: { include: { product: { select: { nameEn: true, nameAr: true } } } } },
        },
      },
    }),
    prisma.order.findMany({
      where: { customerId: id, status: { in: saleStatuses }, purpose: 'SALE' },
      select: {
        grossAmount: true,
        discountAmount: true,
        refundAmount: true,
        deliveryFee: true,
        extraCharges: true,
      },
    }),
  ]);
  if (!c) notFound();

  const name = (locale === 'ar' ? c.nameAr : c.nameEn) || c.nameEn || c.nameAr || c.externalId || '—';
  const items: DetailField[] = [
    { label: t('f.externalId'), value: c.externalId },
    { label: t('f.name'), value: `${c.nameEn ?? ''} / ${c.nameAr ?? ''}` },
    { label: t('f.phone'), value: c.phone },
    { label: t('f.email'), value: c.email },
    { label: t('f.governorate'), value: enumLabel(c.governorate, locale) },
    { label: t('f.address1'), value: c.address1 },
    { label: t('f.street'), value: c.street },
    { label: t('f.segment'), value: enumLabel(c.segment, locale) },
    { label: t('f.source'), value: c.campaignSource },
    { label: t('f.ordersCount'), value: c.ordersCount },
    { label: t('f.firstOrder'), value: c.firstOrderAt ? formatDate(c.firstOrderAt, locale) : '—' },
    { label: t('f.lastOrder'), value: c.lastOrderAt ? formatDate(c.lastOrderAt, locale) : '—' },
    { label: t('f.notes'), value: c.notes },
  ];
  const totalSpend = spendOrders.reduce((sum, order) => sum + invoiceTotal(order), 0);
  const productCounts = new Map<string, number>();
  for (const order of c.orders) {
    for (const line of order.lines) {
      const productName = (locale === 'ar' ? line.product.nameAr : line.product.nameEn) || line.sku;
      productCounts.set(productName, (productCounts.get(productName) ?? 0) + line.quantity);
    }
  }
  const topProducts = [...productCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, qty]) => `${label} (${formatNumber(qty, locale)})`);
  const stats: SummaryStat[] = [
    { label: t('f.ordersCount'), value: formatNumber(c.ordersCount, locale) },
    { label: t('f.totalSpend'), value: formatMoney(totalSpend, 'IQD', locale) },
    { label: t('f.lastOrder'), value: c.lastOrderAt ? formatDate(c.lastOrderAt, locale) : '—' },
  ];
  const orderCols: Column[] = [
    { label: t('f.orderNumber') },
    { label: t('f.date') },
    { label: t('f.net'), align: 'end' },
    { label: t('f.status') },
    { label: '', align: 'end' },
  ];
  const orderRows = c.orders.map((order) => [
    order.orderNumber,
    formatDate(order.placedAt, locale),
    formatMoney(invoiceTotal(order), order.currency, locale),
    enumLabel(order.status, locale),
    <Link key="o" href={`/admin/records/orders/${order.id}`} className="font-medium text-primary hover:underline">
      {t('open')}
    </Link>,
  ]);

  return (
    <>
      <BackLink href="/admin/records/customers" label={t('back')} />
      <PageHeader title={name} subtitle={c.externalId || c.phone || ''} />
      <RecordActions
        editHref={`/admin/records/customers/${c.id}/edit`}
        isActive={c.isActive}
        archiveAction={archiveCustomer.bind(null, c.id, locale, !c.isActive)}
        deleteAction={deleteCustomer.bind(null, c.id, locale)}
        labels={{
          edit: t('edit'),
          archive: t('archive'),
          restore: t('restore'),
          delete: t('delete'),
          confirm: t('confirmDelete'),
        }}
      />
      <RecordsSummary stats={stats} />
      {topProducts.length ? (
        <div className="rounded-[var(--radius)] border bg-card p-4 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground">{t('f.purchasedProducts')}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {topProducts.map((product) => (
              <span key={product} className="rounded-full border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {product}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <DetailGrid items={items} />
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">{t('f.orderHistory')}</h2>
        <DataTable columns={orderCols} rows={orderRows} emptyLabel={t('none')} />
      </div>
    </>
  );
}
