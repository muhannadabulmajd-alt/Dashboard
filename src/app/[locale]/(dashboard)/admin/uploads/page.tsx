import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { formatDate } from '@/lib/dates';
import { formatMoney, formatNumber, type AppLocale } from '@/lib/money';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/data-table/DataTable';
import { RecordsSummary, type SummaryStat } from '@/components/records/Summary';
import { UploadForm } from './UploadForm';
import { CleanupButton } from './CleanupButton';
import type { FinanceType } from '@prisma/client';

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
  const th = await getTranslations('uploads.health');
  const loc = locale as AppLocale;

  // Imported-finance health: explains the "Unassigned (imported)" figure and
  // surfaces any exact-duplicate imported rows (e.g. manual entry + import).
  const IMP_TYPES: FinanceType[] = ['PURCHASE', 'CAPITAL_IN'];
  const [purch, cap, accountless, dupGroups] = await Promise.all([
    prisma.financeEntry.aggregate({ where: { type: 'PURCHASE', importKey: { not: null } }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.financeEntry.aggregate({ where: { type: 'CAPITAL_IN', importKey: { not: null } }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.financeEntry.aggregate({ where: { type: { in: IMP_TYPES }, importKey: { not: null }, accountId: null }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.financeEntry.groupBy({
      by: ['type', 'date', 'amount', 'partyId', 'reference', 'description', 'categoryType'],
      where: { type: { in: IMP_TYPES }, importKey: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const redundant = dupGroups.reduce((s, g) => s + Math.max(0, g._count._all - 1), 0);
  const healthStats: SummaryStat[] = [
    { label: th('purchases'), value: `${formatNumber(purch._count._all, loc)} · ${formatMoney(purch._sum.amount ?? 0, 'IQD', loc)}` },
    { label: th('capital'), value: `${formatNumber(cap._count._all, loc)} · ${formatMoney(cap._sum.amount ?? 0, 'IQD', loc)}` },
    { label: th('unassigned'), value: `${formatNumber(accountless._count._all, loc)} · ${formatMoney(accountless._sum.amount ?? 0, 'IQD', loc)}` },
    { label: th('duplicates'), value: formatNumber(redundant, loc), tone: redundant > 0 ? 'danger' : 'success' },
  ];

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

      <section className="space-y-3 rounded-[var(--radius)] border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{th('title')}</h3>
          {redundant > 0 ? <CleanupButton label={th('clean', { n: redundant })} confirmText={th('confirm')} /> : null}
        </div>
        <RecordsSummary stats={healthStats} />
        <p className="text-xs text-muted-foreground">{redundant > 0 ? th('verdictDupes') : th('verdictClean')}</p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('recent')}</h3>
        <DataTable columns={cols} rows={rows} emptyLabel="—" />
      </section>
    </>
  );
}
