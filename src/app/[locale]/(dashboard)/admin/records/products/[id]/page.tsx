import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { RecordActions } from '@/components/records/RecordActions';
import { archiveProduct, deleteProduct } from '@/server/records/products';

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:products');
  const { id } = await params;
  const t = await getTranslations('records');
  const p = await prisma.product.findUnique({ where: { id } });
  if (!p) notFound();

  const name = locale === 'ar' ? p.nameAr : p.nameEn;
  const items: DetailField[] = [
    { label: t('f.sku'), value: p.sku },
    { label: t('f.name'), value: `${p.nameEn} / ${p.nameAr}` },
    { label: t('f.productLine'), value: enumLabel(p.productLine, locale) },
    { label: t('f.size'), value: p.sizeLabel },
    { label: t('f.grind'), value: enumLabel(p.grind, locale) },
    { label: t('f.roastLevel'), value: p.roastLevel ? enumLabel(p.roastLevel, locale) : '—' },
    { label: t('f.origin'), value: p.origin },
    { label: t('f.price'), value: formatMoney(p.sellingPrice, p.sellingCurrency, locale) },
    { label: t('f.cost'), value: formatMoney(p.cogsPerUnit, p.sellingCurrency, locale) },
    {
      label: t('f.status'),
      value: (
        <Badge variant={p.isActive ? 'success' : 'muted'}>{p.isActive ? t('f.active') : t('f.inactive')}</Badge>
      ),
    },
  ];

  return (
    <>
      <BackLink href="/admin/records/products" label={t('back')} />
      <PageHeader title={name} subtitle={p.sku} />
      <RecordActions
        editHref={`/admin/records/products/${p.id}/edit`}
        isActive={p.isActive}
        archiveAction={archiveProduct.bind(null, p.id, locale, !p.isActive)}
        deleteAction={deleteProduct.bind(null, p.id, locale)}
        labels={{
          edit: t('edit'),
          archive: t('archive'),
          restore: t('restore'),
          delete: t('delete'),
          confirm: t('confirmDelete'),
        }}
      />
      <DetailGrid items={items} />
    </>
  );
}
