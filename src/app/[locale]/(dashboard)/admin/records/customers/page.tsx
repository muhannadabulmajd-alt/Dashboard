import { getTranslations } from 'next-intl/server';
import type { Prisma } from '@prisma/client';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel, CUSTOMER_SEGMENTS } from '@/lib/enums';
import { formatNumber } from '@/lib/money';
import { PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { RecordsSummary, type SummaryStat } from '@/components/records/Summary';
import { TableToolbar } from '@/components/records/TableToolbar';
import { Plus, ShoppingBag } from 'lucide-react';
import { BackLink } from '@/components/records/parts';
import { SectionGuide } from '@/components/records/SectionGuide';
import { Link } from '@/i18n/navigation';

const CUSTOMER_SORTS: Record<string, Prisma.CustomerOrderByWithRelationInput> = {
  ordersDesc: { ordersCount: 'desc' },
  newest: { createdAt: 'desc' },
  oldest: { createdAt: 'asc' },
  nameAsc: { nameEn: 'asc' },
};

export default async function CustomersRecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:customers');
  const t = await getTranslations('records');
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const segment = typeof sp.segment === 'string' ? sp.segment : '';
  const sort = typeof sp.sort === 'string' ? sp.sort : '';

  const where: Prisma.CustomerWhereInput = {
    AND: [
      q
        ? {
            OR: [
              { nameEn: { contains: q, mode: 'insensitive' } },
              { nameAr: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q, mode: 'insensitive' } },
              { externalId: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {},
      segment ? { segment: segment as (typeof CUSTOMER_SEGMENTS)[number] } : {},
    ],
  };

  const [total, withOrders, repeat, customers] = await Promise.all([
    prisma.customer.count(),
    prisma.customer.count({ where: { ordersCount: { gt: 0 } } }),
    prisma.customer.count({ where: { ordersCount: { gt: 1 } } }),
    prisma.customer.findMany({ where, orderBy: CUSTOMER_SORTS[sort] ?? CUSTOMER_SORTS.ordersDesc, take: 500 }),
  ]);

  const stats: SummaryStat[] = [
    { label: t('k.total'), value: formatNumber(total, locale) },
    { label: t('k.withOrders'), value: formatNumber(withOrders, locale), tone: 'success' },
    { label: t('k.repeat'), value: formatNumber(repeat, locale) },
  ];
  const sortOpts = ['ordersDesc', 'newest', 'oldest', 'nameAsc'].map((v) => ({ value: v, label: t(`tools.${v}`) }));
  const segmentOpts = CUSTOMER_SEGMENTS.map((s) => ({ value: s, label: enumLabel(s, locale) }));

  const cols: Column[] = [
    { label: t('f.externalId') },
    { label: t('f.name') },
    { label: t('f.phone') },
    { label: t('f.governorate') },
    { label: t('f.segment') },
    { label: t('f.ordersCount'), align: 'end' },
    { label: '', align: 'end' },
  ];
  const rows = customers.map((c) => {
    const name = (locale === 'ar' ? c.nameAr : c.nameEn) || c.nameEn || c.nameAr || c.externalId || '—';
    return [
      <span key="id" className="font-mono text-xs text-muted-foreground">{c.externalId ?? '—'}</span>,
      name,
      c.phone,
      enumLabel(c.governorate, locale),
      enumLabel(c.segment, locale),
      c.ordersCount,
      <Link key="o" href={`/admin/records/customers/${c.id}`} className="font-medium text-primary hover:underline">
        {t('open')}
      </Link>,
    ];
  });

  return (
    <>
      <BackLink href="/admin/records" label={t('back')} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={t('entities.customers')} subtitle={t('total', { n: customers.length })} />
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Link
            href="/customers/product-buyers"
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-roast hover:bg-linen/40 sm:flex-none"
          >
            <ShoppingBag className="size-4" />
            {t('productBuyers')}
          </Link>
          <Link
            href="/admin/records/customers/new"
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 sm:flex-none"
          >
            <Plus className="size-4" />
            {t('add')}
          </Link>
        </div>
      </div>
      <SectionGuide title={t('guide.customers.title')} intro={t('guide.customers.intro')} points={t.raw('guide.customers.points') as string[]} />
      <RecordsSummary stats={stats} />
      <TableToolbar
        searchPlaceholder={t('tools.search')}
        filters={[{ name: 'segment', label: t('f.segment'), options: segmentOpts }]}
        sorts={sortOpts}
        sortLabel={t('tools.sort')}
      />
      <DataTable columns={cols} rows={rows} emptyLabel={t('none')} />
    </>
  );
}
