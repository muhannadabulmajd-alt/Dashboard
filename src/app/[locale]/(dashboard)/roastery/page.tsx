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

  // Roasted subset (has output) drives yield metrics; green input counts all batches.
  const roastedBatches = batches
    .filter((b) => b.roastedOutputGrams != null && b.roastLevel != null && b.roastDate != null)
    .map((b) => ({
      greenInputGrams: b.greenInputGrams,
      roastedOutputGrams: b.roastedOutputGrams as number,
      roastLevel: b.roastLevel!,
      roastDate: b.roastDate as Date,
    }));
  const green = batches.reduce((s, b) => s + b.greenInputGrams, 0);
  const roasted = roastedBatches.reduce((s, b) => s + b.roastedOutputGrams, 0);
  const kg = (g: number) => `${formatNumber(Math.round(g / 1000), locale)} kg`;

  const roastMix = M.roastLevelMix(roastedBatches).map((r) => ({ label: enumLabel(r.roastLevel, locale), value: r.outputGrams }));
  const operators = M.operatorActivity(
    batches
      .filter((b) => b.roastedOutputGrams != null)
      .map((b) => ({ operatorName: b.operatorName, greenInputGrams: b.greenInputGrams, roastedOutputGrams: b.roastedOutputGrams as number })),
  ).map((o) => ({ label: o.operator, value: o.outputGrams }));
  const qcDist = M.qcDistribution(batches).map((d) => ({ label: `${d.band}–${d.band + 5}`, value: d.count }));

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
    b.roastLevel ? enumLabel(b.roastLevel, locale) : '—',
    b.roastedOutputGrams != null ? kg(b.roastedOutputGrams) : '—',
    b.roastedOutputGrams != null
      ? formatPercent(M.shrinkagePct(b.greenInputGrams, b.roastedOutputGrams), locale)
      : '—',
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
        <KpiCard label={t('avgShrinkage')} value={formatPercent(M.avgShrinkage(roastedBatches), locale)} locale={locale} invertDelta />
        <KpiCard label={t('avgQc')} value={formatNumber(M.avgQcScore(batches), locale, 1)} locale={locale} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <DonutChartCard title={t('roastMix')} data={roastMix} locale={locale} valueKind="count" />
        <BarChartCard title={t('operators')} data={operators} locale={locale} valueKind="count" horizontal />
        <BarChartCard title={t('qcDistribution')} data={qcDist} locale={locale} valueKind="count" />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('batchLog')}</h3>
        <DataTable columns={cols} rows={rows} emptyLabel={tc('noData')} />
      </section>
    </>
  );
}
