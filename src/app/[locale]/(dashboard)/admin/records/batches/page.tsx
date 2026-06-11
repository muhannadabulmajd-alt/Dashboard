import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { RecordsSummary, type SummaryStat } from '@/components/records/Summary';
import { TableToolbar } from '@/components/records/TableToolbar';
import { Plus } from 'lucide-react';
import { BackLink } from '@/components/records/parts';
import { SectionGuide } from '@/components/records/SectionGuide';
import { Link } from '@/i18n/navigation';
import { formatNumber, formatPercent } from '@/lib/money';
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
  const sp = await searchParams;
  const batches = await prisma.roastBatch.findMany({ orderBy: { batchNumber: 'asc' } });
  const q = (typeof sp.q === 'string' ? sp.q.trim() : '').toLowerCase();
  const status = typeof sp.status === 'string' ? sp.status : '';
  const sort = typeof sp.sort === 'string' ? sp.sort : '';

  const roastedBatches = batches.filter((b) => b.roastedOutputGrams != null);
  const outputKg = roastedBatches.reduce((s, b) => s + (b.roastedOutputGrams ?? 0), 0) / 1000;
  const stats: SummaryStat[] = [
    { label: t('k.total'), value: formatNumber(batches.length, locale) },
    { label: t('f.roasted'), value: formatNumber(roastedBatches.length, locale), tone: 'success' },
    { label: t('f.pending'), value: formatNumber(batches.length - roastedBatches.length, locale), tone: 'warning' },
    { label: t('k.completion'), value: formatPercent(batches.length ? roastedBatches.length / batches.length : 0, locale, 0) },
    { label: t('k.output'), value: `${formatNumber(outputKg, locale, 1)} kg` },
  ];

  const cols: Column[] = [
    { label: t('f.batchNumber') },
    { label: t('f.origin') },
    { label: t('f.green'), align: 'end' },
    { label: t('f.status') },
    { label: t('f.roastDate') },
    { label: '', align: 'end' },
  ];

  const visible = batches
    .filter((b) => {
      const roasted = b.roastedOutputGrams != null;
      const matchesStatus = !status || (status === 'roasted' ? roasted : !roasted);
      const matchesSearch = !q || `${b.batchNumber} ${b.origin}`.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    })
    .sort((a, b) => {
      if (sort === 'newest') return (b.roastDate?.getTime() ?? b.createdAt.getTime()) - (a.roastDate?.getTime() ?? a.createdAt.getTime());
      if (sort === 'oldest') return (a.roastDate?.getTime() ?? a.createdAt.getTime()) - (b.roastDate?.getTime() ?? b.createdAt.getTime());
      return a.batchNumber.localeCompare(b.batchNumber);
    });

  const rows = visible.map((b) => {
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
      <div className="flex items-center justify-between gap-3">
        <PageHeader title={t('entities.batches')} subtitle={t('total', { n: batches.length })} />
        <Link
          href="/admin/records/batches/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
        >
          <Plus className="size-4" />
          {t('add')}
        </Link>
      </div>
      <SectionGuide title={t('guide.batches.title')} intro={t('guide.batches.intro')} points={t.raw('guide.batches.points') as string[]} />
      <RecordsSummary stats={stats} />
      <TableToolbar
        searchPlaceholder={t('tools.search')}
        filters={[{ name: 'status', label: t('f.status'), options: [{ value: 'roasted', label: t('f.roasted') }, { value: 'pending', label: t('f.pending') }] }]}
        sorts={['newest', 'oldest'].map((v) => ({ value: v, label: t(`tools.${v}`) }))}
        sortLabel={t('tools.sort')}
      />
      <DataTable
        columns={cols}
        rows={rows}
        emptyLabel={t('none')}
        emptyActionHref="/admin/records/batches/new"
        emptyActionLabel={t('add')}
      />
    </>
  );
}
