import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { createInventory } from '@/server/records/inventory';
import { inventoryFields } from '../_fields';

/** Active variations as options (value = id, label = SKU · name) for linking. */
async function variationOptions(locale: string) {
  const products = await prisma.product.findMany({ where: { isActive: true }, orderBy: { sku: 'asc' } });
  return products.map((p) => ({ value: p.id, label: `${p.sku} · ${locale === 'ar' ? p.nameAr : p.nameEn}` }));
}

export default async function NewInventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:inventory');
  const t = await getTranslations('records');
  const tk = (k: string) => t(k);
  const products = await variationOptions(locale);
  const errors = { invalid: t('err.invalid'), exists: t('err.exists'), forbidden: t('err.forbidden') };

  return (
    <>
      <BackLink href="/admin/records/inventory" label={t('back')} />
      <PageHeader title={t('newTitle', { entity: t('entities.inventory') })} />
      <RecordForm
        action={createInventory}
        fields={inventoryFields(tk, locale, products)}
        locale={locale}
        submitLabel={t('create')}
        cancelHref="/admin/records/inventory"
        cancelLabel={t('cancel')}
        errors={errors}
      />
    </>
  );
}
