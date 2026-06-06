import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { Link } from '@/i18n/navigation';

export default async function ProductsRecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:products');
  const t = await getTranslations('records');
  const products = await prisma.product.findMany({ orderBy: { sku: 'asc' } });

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
      <PageHeader title={t('entities.products')} subtitle={t('total', { n: products.length })} />
      <DataTable columns={cols} rows={rows} emptyLabel={t('none')} />
    </>
  );
}
