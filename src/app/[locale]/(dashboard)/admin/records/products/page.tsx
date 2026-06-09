import { getTranslations } from 'next-intl/server';
import type { Prisma } from '@prisma/client';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel, PRODUCT_LINES } from '@/lib/enums';
import { formatMoney, formatNumber, type AppLocale } from '@/lib/money';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { RecordsSummary, type SummaryStat } from '@/components/records/Summary';
import { TableToolbar } from '@/components/records/TableToolbar';
import { SectionGuide } from '@/components/records/SectionGuide';
import { Plus, Layers, Boxes } from 'lucide-react';
import { BackLink } from '@/components/records/parts';
import { Link } from '@/i18n/navigation';

const PRODUCT_SORTS: Record<string, Prisma.ProductOrderByWithRelationInput> = {
  skuAsc: { sku: 'asc' },
  nameAsc: { nameEn: 'asc' },
  amountDesc: { sellingPrice: 'desc' },
  amountAsc: { sellingPrice: 'asc' },
};

/** Two sub-views: main products (default) and the flat variation list. */
type View = 'main' | 'variations';

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
  const view: View = sp.view === 'variations' ? 'variations' : 'main';

  return (
    <>
      <BackLink href="/admin/records" label={t('back')} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={t('entities.productsVariations')} subtitle={t('entityHints.productsVariations')} />
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/admin/records/product-groups/new"
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <Plus className="size-4" />
            {t('addMainProduct')}
          </Link>
          <Link
            href="/admin/records/products/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
          >
            <Plus className="size-4" />
            {t('addVariation')}
          </Link>
        </div>
      </div>

      <SectionGuide title={t('guide.products.title')} intro={t('guide.products.intro')} points={t.raw('guide.products.points') as string[]} />

      {/* main / variations switcher */}
      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1 text-sm">
        <Link
          href="/admin/records/products?view=main"
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium ${view === 'main' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Layers className="size-4" />
          {t('mainProducts')}
        </Link>
        <Link
          href="/admin/records/products?view=variations"
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium ${view === 'variations' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Boxes className="size-4" />
          {t('variationsView')}
        </Link>
      </div>

      {view === 'main' ? <MainProductsView locale={locale} t={t} /> : <VariationsView locale={locale} t={t} tc={tc} sp={sp} />}
    </>
  );
}

/** Main products (groups) with their variation counts + an ungrouped bucket. */
async function MainProductsView({ locale, t }: { locale: AppLocale; t: Awaited<ReturnType<typeof getTranslations>> }) {
  const [groups, ungrouped] = await Promise.all([
    prisma.productGroup.findMany({
      orderBy: { code: 'asc' },
      include: { _count: { select: { products: true } } },
    }),
    prisma.product.count({ where: { groupId: null } }),
  ]);

  const cols: Column[] = [
    { label: t('f.code') },
    { label: t('f.mainProduct') },
    { label: t('f.productLine') },
    { label: t('f.variations'), align: 'end' },
    { label: t('f.status') },
    { label: '', align: 'end' },
  ];
  const rows = groups.map((g) => [
    <span key="c" className="font-mono text-xs text-muted-foreground">{g.code}</span>,
    locale === 'ar' ? g.nameAr : g.nameEn,
    enumLabel(g.productLine, locale),
    formatNumber(g._count.products, locale),
    <Badge key="s" variant={g.isActive ? 'success' : 'muted'}>{g.isActive ? t('f.active') : t('f.inactive')}</Badge>,
    <Link key="o" href={`/admin/records/product-groups/${g.id}`} className="font-medium text-primary hover:underline">
      {t('open')}
    </Link>,
  ]);

  return (
    <div className="space-y-3">
      <DataTable columns={cols} rows={rows} emptyLabel={t('none')} />
      {ungrouped > 0 ? (
        <Link
          href="/admin/records/products?view=variations&group=none"
          className="flex items-center justify-between rounded-[var(--radius)] border border-dashed bg-card px-4 py-3 text-sm hover:border-primary"
        >
          <span className="flex items-center gap-2 font-medium">
            <Boxes className="size-4 text-muted-foreground" />
            {t('ungroupedVariations')}
          </span>
          <span className="text-muted-foreground">
            {formatNumber(ungrouped, locale)} · {t('ungroupedHint')}
          </span>
        </Link>
      ) : null}
    </div>
  );
}

/** Flat, searchable/sortable variation list (the previous Products screen). */
async function VariationsView({
  locale,
  t,
  tc,
  sp,
}: {
  locale: AppLocale;
  t: Awaited<ReturnType<typeof getTranslations>>;
  tc: Awaited<ReturnType<typeof getTranslations>>;
  sp: Record<string, string | string[] | undefined>;
}) {
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const line = typeof sp.line === 'string' ? sp.line : '';
  const group = typeof sp.group === 'string' ? sp.group : '';
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
      group === 'none' ? { groupId: null } : {},
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
    <Badge key="s" variant={p.isActive ? 'success' : 'muted'}>{p.isActive ? t('f.active') : t('f.inactive')}</Badge>,
    <Link key="o" href={`/admin/records/products/${p.id}`} className="font-medium text-primary hover:underline">
      {t('open')}
    </Link>,
  ]);

  return (
    <>
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
