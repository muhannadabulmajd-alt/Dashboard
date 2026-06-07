import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { createBatch } from '@/server/records/batches';
import { batchFields } from '../_fields';

export default async function NewBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:batches');
  const t = await getTranslations('records');
  const tk = (k: string) => t(k);
  const errors = { invalid: t('err.invalid'), exists: t('err.exists'), forbidden: t('err.forbidden') };

  return (
    <>
      <BackLink href="/admin/records/batches" label={t('back')} />
      <PageHeader title={t('newTitle', { entity: t('entities.batches') })} />
      <RecordForm
        action={createBatch}
        fields={batchFields(tk, locale)}
        locale={locale}
        submitLabel={t('create')}
        cancelHref="/admin/records/batches"
        cancelLabel={t('cancel')}
        errors={errors}
      />
    </>
  );
}
