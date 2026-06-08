import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { updateProduct } from '@/server/records/products';
import { productFields } from '../../_fields';

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:products');
  const { id } = await params;
  const t = await getTranslations('records');
  const tk = (k: string) => t(k);
  const [p, groupRows] = await Promise.all([
    prisma.product.findUnique({ where: { id } }),
    prisma.productGroup.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
  ]);
  if (!p) notFound();
  const groups = groupRows.map((g) => ({ value: g.id, label: `${g.code} · ${locale === 'ar' ? g.nameAr : g.nameEn}` }));

  const initial = {
    sku: p.sku,
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    productLine: p.productLine,
    groupId: p.groupId ?? '',
    sizeLabel: p.sizeLabel,
    grind: p.grind,
    roastLevel: p.roastLevel ?? '',
    origin: p.origin ?? '',
    sellingPrice: p.sellingPrice,
    cogsPerUnit: p.cogsPerUnit,
  };
  const errors = { invalid: t('err.invalid'), exists: t('err.exists'), forbidden: t('err.forbidden') };

  return (
    <>
      <BackLink href={`/admin/records/products/${id}`} label={t('back')} />
      <PageHeader title={t('editTitle', { entity: t('entities.products') })} subtitle={p.sku} />
      <RecordForm
        action={updateProduct.bind(null, id)}
        fields={productFields(tk, locale, 'edit', groups)}
        initial={initial}
        locale={locale}
        submitLabel={t('save')}
        cancelHref={`/admin/records/products/${id}`}
        cancelLabel={t('cancel')}
        errors={errors}
      />
    </>
  );
}
