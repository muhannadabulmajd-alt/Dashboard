import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { RecordActions } from '@/components/records/RecordActions';
import { archiveProductGroup, deleteProductGroup } from '@/server/records/product-groups';
import { Link } from '@/i18n/navigation';

export default async function ProductGroupDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:products');
  const { id } = await params;
  const t = await getTranslations('records');
  const g = await prisma.productGroup.findUnique({
    where: { id },
    include: { products: { orderBy: { sku: 'asc' } } },
  });
  if (!g) notFound();

  const name = locale === 'ar' ? g.nameAr : g.nameEn;
  const items: DetailField[] = [
    { label: t('f.code'), value: g.code },
    { label: t('f.name'), value: `${g.nameEn} / ${g.nameAr}` },
    { label: t('f.productLine'), value: enumLabel(g.productLine, locale) },
    { label: t('f.description'), value: g.description },
    { label: t('f.variations'), value: g.products.length },
    {
      label: t('f.status'),
      value: <Badge variant={g.isActive ? 'success' : 'muted'}>{g.isActive ? t('f.active') : t('f.inactive')}</Badge>,
    },
  ];

  const varCols: Column[] = [
    { label: t('f.sku') },
    { label: t('f.name') },
    { label: t('f.size') },
    { label: t('f.grind') },
    { label: t('f.price'), align: 'end' },
    { label: t('f.status') },
  ];
  const varRows = g.products.map((p) => [
    <span key="s" className="font-mono text-xs text-muted-foreground">{p.sku}</span>,
    <Link key="n" href={`/admin/records/products/${p.id}`} className="font-medium text-primary hover:underline">
      {locale === 'ar' ? p.nameAr : p.nameEn}
    </Link>,
    p.sizeLabel,
    enumLabel(p.grind, locale),
    formatMoney(p.sellingPrice, p.sellingCurrency, locale),
    <Badge key="st" variant={p.isActive ? 'success' : 'muted'}>
      {p.isActive ? t('f.active') : t('f.inactive')}
    </Badge>,
  ]);

  return (
    <>
      <BackLink href="/admin/records/product-groups" label={t('back')} />
      <PageHeader title={name} subtitle={g.code} />
      <RecordActions
        editHref={`/admin/records/product-groups/${g.id}/edit`}
        isActive={g.isActive}
        archiveAction={archiveProductGroup.bind(null, g.id, locale, !g.isActive)}
        deleteAction={deleteProductGroup.bind(null, g.id, locale)}
        labels={{
          edit: t('edit'),
          archive: t('archive'),
          restore: t('restore'),
          delete: t('delete'),
          confirm: t('confirmDelete'),
        }}
      />
      <DetailGrid items={items} />
      <div className="mt-4 space-y-2">
        <h3 className="text-sm font-semibold">{t('f.variations')}</h3>
        <DataTable columns={varCols} rows={varRows} emptyLabel={t('none')} />
      </div>
    </>
  );
}
