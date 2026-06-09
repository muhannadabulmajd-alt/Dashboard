import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel, ROAST_LEVELS } from '@/lib/enums';
import { formatMoney, formatNumber, formatPercent } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { gramsPerUnit } from '@/lib/roast';
import { roastedCostPerKg } from '@/lib/metrics/roasting';
import { getRoastConfig } from '@/server/settings';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { RecordActions } from '@/components/records/RecordActions';
import { archiveInventory, deleteInventory } from '@/server/records/inventory';
import type { RoastLevel } from '@prisma/client';

export default async function InventoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:inventory');
  const { id } = await params;
  const t = await getTranslations('records');
  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    include: { movements: { orderBy: { occurredAt: 'desc' } } },
  });
  if (!item) notFound();

  const name = locale === 'ar' ? item.nameAr : item.nameEn;
  const current = item.movements.reduce((s, m) => s + m.quantity, 0);

  // Green→roasted cost estimate (§5): for green coffee, project roasted cost per
  // roast type from this bean's cost-per-kg and the configured yields.
  let roast: { lvl: RoastLevel; y: number; perKg: number; per250: number }[] | null = null;
  if (item.category === 'GREEN_COFFEE' && item.unitCost != null) {
    const cfg = await getRoastConfig();
    const greenPerKg = item.unitCost * (1000 / gramsPerUnit(item.unit));
    roast = ROAST_LEVELS.map((lvl) => {
      const y = cfg.yields[lvl as RoastLevel];
      const perKg = roastedCostPerKg(greenPerKg, y, cfg.roastingCostPerKg);
      return { lvl: lvl as RoastLevel, y, perKg, per250: Math.round(perKg * 0.25) };
    });
  }

  const items: DetailField[] = [
    { label: t('f.item'), value: `${item.nameEn} / ${item.nameAr}` },
    { label: t('f.category'), value: enumLabel(item.category, locale) },
    { label: t('f.unit'), value: item.unit },
    { label: t('f.currentStock'), value: formatNumber(current, locale) },
    {
      label: t('f.reorderPoint'),
      value: item.reorderPoint != null ? formatNumber(item.reorderPoint, locale) : '—',
    },
    {
      label: t('f.avgDailyUsage'),
      value: item.avgDailyUsage != null ? formatNumber(item.avgDailyUsage, locale) : '—',
    },
    {
      label: t('f.unitCost'),
      value: item.unitCost != null ? formatMoney(item.unitCost, 'IQD', locale) : '—',
    },
  ];

  const mCols: Column[] = [
    { label: t('f.occurredAt') },
    { label: t('f.reason') },
    { label: t('f.quantity'), align: 'end' },
  ];

  const mRows = item.movements.map((m) => [
    formatDate(m.occurredAt, locale),
    enumLabel(m.reason, locale),
    formatNumber(m.quantity, locale),
  ]);

  return (
    <>
      <BackLink href="/admin/records/inventory" label={t('back')} />
      <PageHeader title={name} subtitle={enumLabel(item.category, locale)} />
      <RecordActions
        editHref={`/admin/records/inventory/${item.id}/edit`}
        isActive={item.isActive}
        archiveAction={archiveInventory.bind(null, item.id, locale, !item.isActive)}
        deleteAction={deleteInventory.bind(null, item.id, locale)}
        labels={{
          edit: t('edit'),
          archive: t('archive'),
          restore: t('restore'),
          delete: t('delete'),
          confirm: t('confirmDelete'),
        }}
      />
      <DetailGrid items={items} />

      {roast ? (
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold">{t('roastedCost')}</h3>
          <p className="text-xs text-muted-foreground">{t('roastedCostHint')}</p>
          <DataTable
            columns={[
              { label: t('f.roastLevel') },
              { label: t('f.yield'), align: 'end' },
              { label: t('perKg'), align: 'end' },
              { label: t('per250'), align: 'end' },
            ]}
            rows={roast.map((r) => [
              enumLabel(r.lvl, locale),
              formatPercent(r.y, locale, 0),
              formatMoney(r.perKg, 'IQD', locale),
              formatMoney(r.per250, 'IQD', locale),
            ])}
            emptyLabel="—"
          />
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        <h3 className="text-sm font-semibold">{t('f.movements')}</h3>
        <DataTable columns={mCols} rows={mRows} emptyLabel={t('none')} />
      </div>
    </>
  );
}
