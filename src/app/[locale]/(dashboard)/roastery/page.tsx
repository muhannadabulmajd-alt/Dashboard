import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getBatchRows } from '@/server/db/repositories/roastery.repo';
import * as M from '@/lib/metrics';
import { enumLabel } from '@/lib/enums';
import { formatNumber, formatPercent } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { KpiCard } from '@/components/kpi/KpiCard';
import { DonutChartCard, BarChartCard } from '@/components/charts/Charts';
import { DataTable } from '@/components/data-table/DataTable';
import { PageHeader } from '@/components/ui/primitives';

export default async function RoasteryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, filters, scope, range } = await getPageContext(params, searchParams, 'view:roastery');
  const t = await getTranslations('roastery');
  const tc = await getTranslations('common');

  const batches = await getBatchRows(filters, scope, range);

  const green = M.totalGreenInput(batches);
  const roasted = M.totalRoastedOutput(batches);
  const kg = (g: number) => `${formatNumber(Math.round(g / 1000), locale)} kg`;

  const roastMix = M.roastLevelMix(batches).map((r) => ({ label: enumLabel(r.roastLevel, locale), value: r.outputGrams }));
  const operators = M.operatorActivity(batches).map((o) => ({ label: o.operator, value: o.outputGrams }));

  const cols = [
    { label: t('batchNumber') },
    { label: t('origin') },
    { label: t('roast') },
    { label: t('output'), align: 'end' as const },
    { label: t('shrinkage'), align: 'end' as const },
    { label: t('qc'), align: 'end' as const },
    { label: t('operator') },
  ];
  const rows = batches.map((b) => [
    b.batchNumber,
    b.origin,
    enumLabel(b.roastLevel, locale),
    kg(b.roastedOutputGrams),
    formatPercent(M.shrinkagePct(b.greenInputGrams, b.roastedOutputGrams), locale),
    b.qcScore != null ? formatNumber(b.qcScore, locale, 1) : '—',
    b.operatorName ?? '—',
  ]);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label={t('batches')} value={formatNumber(batches.length, locale)} locale={locale} />
        <KpiCard label={t('greenInput')} value={kg(green)} locale={locale} />
        <KpiCard label={t('roastedOutput')} value={kg(roasted)} locale={locale} />
        <KpiCard label={t('avgShrinkage')} value={formatPercent(M.avgShrinkage(batches), locale)} locale={locale} invertDelta />
        <KpiCard label={t('avgQc')} value={formatNumber(M.avgQcScore(batches), locale, 1)} locale={locale} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <DonutChartCard title={t('roastMix')} data={roastMix} locale={locale} valueKind="count" />
        <BarChartCard title={t('operators')} data={operators} locale={locale} valueKind="count" horizontal />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('batchLog')}</h3>
        <DataTable columns={cols} rows={rows} emptyLabel={tc('noData')} />
      </section>
    </>
  );
}
