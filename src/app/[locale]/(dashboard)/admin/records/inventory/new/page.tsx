import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { createInventory } from '@/server/records/inventory';
import { inventoryFields } from '../_fields';

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
  const errors = { invalid: t('err.invalid'), exists: t('err.exists'), forbidden: t('err.forbidden') };

  return (
    <>
      <BackLink href="/admin/records/inventory" label={t('back')} />
      <PageHeader title={t('newTitle', { entity: t('entities.inventory') })} />
      <RecordForm
        action={createInventory}
        fields={inventoryFields(tk, locale)}
        locale={locale}
        submitLabel={t('create')}
        cancelHref="/admin/records/inventory"
        cancelLabel={t('cancel')}
        errors={errors}
      />
    </>
  );
}
