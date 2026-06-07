import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { createProduct } from '@/server/records/products';
import { productFields } from '../_fields';

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
  const errors = { invalid: t('err.invalid'), exists: t('err.exists'), forbidden: t('err.forbidden') };

  return (
    <>
      <BackLink href="/admin/records/products" label={t('back')} />
      <PageHeader title={t('newTitle', { entity: t('entities.products') })} />
      <RecordForm
        action={createProduct}
        fields={productFields(tk, locale)}
        locale={locale}
        submitLabel={t('create')}
        cancelHref="/admin/records/products"
        cancelLabel={t('cancel')}
        errors={errors}
      />
    </>
  );
}
