import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { updateProductGroup } from '@/server/records/product-groups';
import { productGroupFields } from '../../_fields';

export default async function EditProductGroupPage({
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
  const g = await prisma.productGroup.findUnique({ where: { id } });
  if (!g) notFound();

  const initial = {
    code: g.code,
    nameEn: g.nameEn,
    nameAr: g.nameAr,
    productLine: g.productLine,
    productType: g.productType ?? '',
    description: g.description ?? '',
    imageUrl: g.imageUrl ?? '',
    storefrontSlug: g.storefrontSlug ?? '',
    storefrontPublished: g.storefrontPublished,
  };
  const errors = { invalid: t('err.invalid'), exists: t('err.exists'), forbidden: t('err.forbidden') };

  return (
    <>
      <BackLink href={`/admin/records/product-groups/${id}`} label={t('back')} />
      <PageHeader title={t('editTitle', { entity: t('entities.productGroups') })} subtitle={g.code} />
      <RecordForm
        action={updateProductGroup.bind(null, id)}
        fields={productGroupFields(tk, locale, 'edit')}
        initial={initial}
        locale={locale}
        submitLabel={t('save')}
        cancelHref={`/admin/records/product-groups/${id}`}
        cancelLabel={t('cancel')}
        errors={errors}
      />
    </>
  );
}
