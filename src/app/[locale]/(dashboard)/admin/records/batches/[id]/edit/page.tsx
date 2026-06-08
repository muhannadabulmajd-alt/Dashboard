import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { updateBatch } from '@/server/records/batches';
import { batchFields } from '../../_fields';

export default async function EditBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:batches');
  const { id } = await params;
  const t = await getTranslations('records');
  const tk = (k: string) => t(k);
  const b = await prisma.roastBatch.findUnique({ where: { id } });
  if (!b) notFound();

  const initial = {
    batchNumber: b.batchNumber,
    origin: b.origin,
    roastDate: b.roastDate ? b.roastDate.toISOString().slice(0, 10) : '',
    roastLevel: b.roastLevel ?? '',
    greenInputGrams: b.greenInputGrams,
    roastedOutputGrams: b.roastedOutputGrams ?? '',
    qcScore: b.qcScore ?? '',
    qcNotes: b.qcNotes ?? '',
  };
  const errors = { invalid: t('err.invalid'), exists: t('err.exists'), forbidden: t('err.forbidden') };

  return (
    <>
      <BackLink href={`/admin/records/batches/${id}`} label={t('back')} />
      <PageHeader title={t('editTitle', { entity: t('entities.batches') })} subtitle={b.origin} />
      <RecordForm
        action={updateBatch.bind(null, id)}
        fields={batchFields(tk, locale, 'edit')}
        initial={initial}
        locale={locale}
        submitLabel={t('save')}
        cancelHref={`/admin/records/batches/${id}`}
        cancelLabel={t('cancel')}
        errors={errors}
      />
    </>
  );
}
