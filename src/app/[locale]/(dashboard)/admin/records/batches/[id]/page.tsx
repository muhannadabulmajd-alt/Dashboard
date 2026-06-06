import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { formatNumber, formatPercent } from '@/lib/money';
import { formatDate } from '@/lib/dates';

export default async function BatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:batches');
  const { id } = await params;
  const t = await getTranslations('records');
  const b = await prisma.roastBatch.findUnique({ where: { id } });
  if (!b) notFound();

  const roasted = b.roastedOutputGrams != null;

  const items: DetailField[] = [
    { label: t('f.batchNumber'), value: b.batchNumber },
    { label: t('f.origin'), value: b.origin },
    {
      label: t('f.status'),
      value: (
        <Badge variant={roasted ? 'success' : 'warning'}>
          {roasted ? t('f.roasted') : t('f.pending')}
        </Badge>
      ),
    },
    { label: t('f.roastDate'), value: b.roastDate ? formatDate(b.roastDate, locale) : '—' },
    { label: t('f.roastLevel'), value: b.roastLevel ? enumLabel(b.roastLevel, locale) : '—' },
    { label: t('f.green'), value: formatNumber(b.greenInputGrams, locale) },
    {
      label: t('f.output'),
      value: b.roastedOutputGrams != null ? formatNumber(b.roastedOutputGrams, locale) : '—',
    },
    {
      label: t('f.yield'),
      value:
        b.roastedOutputGrams != null && b.greenInputGrams > 0
          ? formatPercent(b.roastedOutputGrams / b.greenInputGrams, locale)
          : '—',
    },
    {
      label: t('f.shrinkage'),
      value:
        b.roastedOutputGrams != null && b.greenInputGrams > 0
          ? formatPercent(1 - b.roastedOutputGrams / b.greenInputGrams, locale)
          : '—',
    },
    {
      label: t('f.qc'),
      value: b.qcScore != null ? formatNumber(b.qcScore, locale) : '—',
    },
  ];

  return (
    <>
      <BackLink href="/admin/records/batches" label={t('back')} />
      <PageHeader title={b.batchNumber} subtitle={b.origin} />
      <DetailGrid items={items} />
    </>
  );
}
