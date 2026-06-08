import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { createProduct } from '@/server/records/products';
import { productFields } from '../_fields';

/** Active parent groups as form options (value = id, label = code · name). */
async function groupOptions(locale: string) {
  const groups = await prisma.productGroup.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  return groups.map((g) => ({ value: g.id, label: `${g.code} · ${locale === 'ar' ? g.nameAr : g.nameEn}` }));
}

export default async function NewProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:products');
  const t = await getTranslations('records');
  const tk = (k: string) => t(k);
  const groups = await groupOptions(locale);
  const errors = { invalid: t('err.invalid'), exists: t('err.exists'), forbidden: t('err.forbidden') };

  return (
    <>
      <BackLink href="/admin/records/products" label={t('back')} />
      <PageHeader title={t('newTitle', { entity: t('entities.products') })} />
      <RecordForm
        action={createProduct}
        fields={productFields(tk, locale, 'new', groups)}
        locale={locale}
        submitLabel={t('create')}
        cancelHref="/admin/records/products"
        cancelLabel={t('cancel')}
        errors={errors}
      />
    </>
  );
}
