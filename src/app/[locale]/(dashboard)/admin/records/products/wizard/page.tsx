import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { enumLabel, PRODUCT_LINES, GRINDS } from '@/lib/enums';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink } from '@/components/records/parts';
import { ProductWizard } from '@/components/records/ProductWizard';

export default async function ProductWizardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:products');
  const t = await getTranslations('records');
  const productLines = PRODUCT_LINES.map((v) => ({ value: v, label: enumLabel(v, locale) }));
  const grinds = GRINDS.map((v) => ({ value: v, label: enumLabel(v, locale) }));

  return (
    <>
      <BackLink href="/admin/records/products" label={t('back')} />
      <PageHeader title={t('wizard.title')} subtitle={t('wizard.subtitle')} />
      <ProductWizard locale={locale} productLines={productLines} grinds={grinds} />
    </>
  );
}
