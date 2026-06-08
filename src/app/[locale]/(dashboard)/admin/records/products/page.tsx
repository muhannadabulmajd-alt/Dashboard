import { getTranslations } from 'next-intl/server';
import type { Prisma } from '@prisma/client';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel, PRODUCT_LINES } from '@/lib/enums';
import { formatMoney, formatNumber } from '@/lib/money';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { RecordsSummary, type SummaryStat } from '@/components/records/Summary';
import { TableToolbar } from '@/components/records/TableToolbar';
import { Plus } from 'lucide-react';
import { BackLink } from '@/components/records/parts';
import { Link } from '@/i18n/navigation';

const PRODUCT_SORTS: Record<string, Prisma.ProductOrderByWithRelationInput> = {
  skuAsc: { sku: 'asc' },
  nameAsc: { nameEn: 'asc' },
  amountDesc: { sellingPrice: 'desc' },
  amountAsc: { sellingPrice: 'asc' },
};

export default async function ProductsRecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:products');
  const t = await getTranslations('records');
  const tc = await getTranslations('common');
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const line = typeof sp.line === 'string' ? sp.line : '';
  const sort = typeof sp.sort === 'string' ? sp.sort : '';

  const where: Prisma.ProductWhereInput = {
    AND: [
      q
        ? {
            OR: [
              { sku: { contains: q, mode: 'insensitive' } },
              { nameEn: { contains: q, mode: 'insensitive' } },
              { nameAr: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {},
      line ? { productLine: line as (typeof PRODUCT_LINES)[number] } : {},
    ],
  };

  const [total, active, products] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { isActive: true } }),
    prisma.product.findMany({ where, orderBy: PRODUCT_SORTS[sort] ?? PRODUCT_SORTS.skuAsc, take: 500 }),
  ]);
  const stats: SummaryStat[] = [
    { label: t('k.total'), value: formatNumber(total, locale) },
    { label: t('k.active'), value: formatNumber(active, locale), tone: 'success' },
    { label: t('k.inactive'), value: formatNumber(total - active, locale), tone: 'warning' },
  ];
  const sortOpts = ['nameAsc', 'amountDesc', 'amountAsc'].map((v) => ({ value: v, label: t(`tools.${v}`) }));
  const lineOpts = PRODUCT_LINES.map((l) => ({ value: l, label: enumLabel(l, locale) }));

  const cols: Column[] = [
    { label: t('f.sku') },
    { label: t('f.name') },
    { label: t('f.productLine') },
    { label: t('f.grind') },
    { label: t('f.price'), align: 'end' },
    { label: t('f.status') },
    { label: '', align: 'end' },
  ];
  const rows = products.map((p) => [
    p.sku,
    locale === 'ar' ? p.nameAr : p.nameEn,
    enumLabel(p.productLine, locale),
    enumLabel(p.grind, locale),
    formatMoney(p.sellingPrice, p.sellingCurrency, locale),
    <Badge key="s" variant={p.isActive ? 'success' : 'muted'}>
      {p.isActive ? t('f.active') : t('f.inactive')}
    </Badge>,
    <Link key="o" href={`/admin/records/products/${p.id}`} className="font-medium text-primary hover:underline">
      {t('open')}
    </Link>,
  ]);

  return (
    <>
      <BackLink href="/admin/records" label={t('back')} />
      <div className="flex items-center justify-between gap-3">
        <PageHeader title={t('entities.products')} subtitle={t('total', { n: products.length })} />
        <Link
          href="/admin/records/products/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
        >
          <Plus className="size-4" />
          {t('add')}
        </Link>
      </div>
      <RecordsSummary stats={stats} />
      <TableToolbar
        searchPlaceholder={t('tools.search')}
        filters={[{ name: 'line', label: t('f.productLine'), options: lineOpts }]}
        sorts={sortOpts}
        sortLabel={t('tools.sort')}
      />
      <DataTable
        columns={cols}
        rows={rows}
        emptyLabel={t('none')}
        exportHref={`/api/export?dataset=variations&locale=${locale}`}
        exportLabel={tc('exportCsv')}
      />
    </>
  );
}
