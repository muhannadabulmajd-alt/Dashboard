import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { formatDate } from '@/lib/dates';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/data-table/DataTable';
import { UploadForm } from './UploadForm';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'muted'> = {
  COMPLETED: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
  PROCESSING: 'muted',
  PENDING: 'muted',
};

export default async function UploadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'upload:data');
  const t = await getTranslations('uploads');

  const uploads = await prisma.uploadBatch.findMany({
    orderBy: { uploadedAt: 'desc' },
    take: 12,
    select: {
      id: true,
      dataset: true,
      fileName: true,
      status: true,
      rowsInserted: true,
      rowsUpdated: true,
      rowsSkipped: true,
      uploadedAt: true,
    },
  });

  const cols = [
    { label: t('fileName') },
    { label: t('dataset') },
    { label: t('status') },
    { label: t('rows'), align: 'end' as const },
    { label: t('when'), align: 'end' as const },
  ];
  const rows = uploads.map((u) => [
    u.fileName,
    t(`datasets.${u.dataset.toLowerCase()}`),
    <Badge key="s" variant={STATUS_VARIANT[u.status] ?? 'muted'}>
      {u.status}
    </Badge>,
    `+${u.rowsInserted} / ~${u.rowsUpdated} / −${u.rowsSkipped}`,
    formatDate(u.uploadedAt, locale),
  ]);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <UploadForm />
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('recent')}</h3>
        <DataTable columns={cols} rows={rows} emptyLabel="—" />
      </section>
    </>
  );
}
