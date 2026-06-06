import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { Link } from '@/i18n/navigation';
import { formatNumber } from '@/lib/money';
import { formatDate } from '@/lib/dates';

export default async function BatchesRecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:batches');
  const t = await getTranslations('records');
  const batches = await prisma.roastBatch.findMany({ orderBy: { batchNumber: 'asc' } });

  const cols: Column[] = [
    { label: t('f.batchNumber') },
    { label: t('f.origin') },
    { label: t('f.green'), align: 'end' },
    { label: t('f.status') },
    { label: t('f.roastDate') },
    { label: '', align: 'end' },
  ];

  const rows = batches.map((b) => {
    const roasted = b.roastedOutputGrams != null;
    return [
      b.batchNumber,
      b.origin,
      formatNumber(b.greenInputGrams, locale),
      <Badge key="s" variant={roasted ? 'success' : 'warning'}>
        {roasted ? t('f.roasted') : t('f.pending')}
      </Badge>,
      b.roastDate ? formatDate(b.roastDate, locale) : '—',
      <Link key="o" href={`/admin/records/batches/${b.id}`} className="font-medium text-primary hover:underline">
        {t('open')}
      </Link>,
    ];
  });

  return (
    <>
      <BackLink href="/admin/records" label={t('back')} />
      <PageHeader title={t('entities.batches')} subtitle={t('total', { n: batches.length })} />
      <DataTable columns={cols} rows={rows} emptyLabel={t('none')} />
    </>
  );
}
