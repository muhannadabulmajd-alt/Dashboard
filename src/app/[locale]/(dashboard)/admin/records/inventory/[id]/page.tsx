import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney, formatNumber, formatPercent } from '@/lib/money';
import { formatDate, dateInputValue } from '@/lib/dates';
import { gramsPerUnit, roastYieldFor } from '@/lib/roast';
import { getListOptions } from '@/server/lists/resolver';
import { roastedCostPerKg } from '@/lib/metrics/roasting';
import { fifoStatus } from '@/lib/metrics/inventory';
import { getRoastConfig } from '@/server/settings';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { RecordActions } from '@/components/records/RecordActions';
import { RecordForm, type FieldDef } from '@/components/records/form';
import { archiveInventory, deleteInventory, receiveStock } from '@/server/records/inventory';

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
    include: {
      movements: { orderBy: { occurredAt: 'desc' } },
      costLayers: { orderBy: { receivedAt: 'asc' } },
    },
  });
  if (!item) notFound();

  const name = locale === 'ar' ? item.nameAr : item.nameEn;
  const current = item.movements.reduce((s, m) => s + m.quantity, 0);

  // FIFO cost layers (§8): apply consumption since the first layer (oldest-first)
  // to derive each layer's remaining, the active cost, and the on-hand value.
  const since = item.costLayers[0]?.receivedAt;
  const consumed = since
    ? item.movements.reduce((s, m) => (m.quantity < 0 && m.occurredAt >= since ? s - m.quantity : s), 0)
    : 0;
  const fifo = item.costLayers.length ? fifoStatus(item.costLayers, consumed) : null;

  // Green→roasted cost estimate (§5): for green coffee, project roasted cost
  // per roast level (managed list — added levels use the MEDIUM yield) from
  // this bean's cost-per-kg and the configured yields.
  let roast: { lvl: string; y: number; perKg: number; per250: number }[] | null = null;
  if (item.category === 'GREEN_COFFEE' && item.unitCost != null) {
    const [cfg, levels] = await Promise.all([getRoastConfig(), getListOptions('roastLevel', locale)]);
    const greenPerKg = item.unitCost * (1000 / gramsPerUnit(item.unit));
    roast = levels.map(({ value: lvl }) => {
      const y = roastYieldFor(cfg.yields, lvl);
      const perKg = roastedCostPerKg(greenPerKg, y, cfg.roastingCostPerKg);
      return { lvl, y, perKg, per250: Math.round(perKg * 0.25) };
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

  const receiveFields: FieldDef[] = [
    { name: 'qtyReceived', label: t('f.qtyReceived'), type: 'number', required: true, placeholder: '0' },
    { name: 'unitCost', label: t('f.unitCost'), type: 'number', required: true, placeholder: '0' },
    { name: 'receivedAt', label: t('f.receivedAt'), type: 'date', required: true },
    { name: 'expiryDate', label: t('f.expiryDate'), type: 'date' },
    { name: 'reference', label: t('f.reference'), type: 'text' },
  ];
  const receiveErrors = { invalid: t('err.invalid'), forbidden: t('err.forbidden') };

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

      <div className="mt-6 space-y-2">
        <h3 className="text-sm font-semibold">{t('costLayers')}</h3>
        <p className="text-xs text-muted-foreground">{t('costLayersHint')}</p>
        {fifo ? (
          <>
            <div className="flex flex-wrap gap-4 text-sm">
              <span>
                {t('activeCost')}:{' '}
                <strong>{fifo.activeCost != null ? formatMoney(fifo.activeCost, 'IQD', locale) : '—'}</strong>
              </span>
              <span>
                {t('onHandValue')}: <strong>{formatMoney(fifo.value, 'IQD', locale)}</strong>
              </span>
            </div>
            <DataTable
              columns={[
                { label: t('f.receivedAt') },
                { label: t('f.qtyReceived'), align: 'end' },
                { label: t('f.unitCost'), align: 'end' },
                { label: t('f.remaining'), align: 'end' },
                { label: t('f.value'), align: 'end' },
              ]}
              rows={fifo.layers.map((l) => [
                formatDate(l.receivedAt, locale),
                formatNumber(l.qtyReceived, locale),
                formatMoney(l.unitCost, 'IQD', locale),
                formatNumber(l.remaining, locale),
                formatMoney(l.remaining * l.unitCost, 'IQD', locale),
              ])}
              emptyLabel={t('none')}
            />
          </>
        ) : null}
      </div>

      <div className="mt-4 space-y-2">
        <h3 className="text-sm font-semibold">{t('receiveStock')}</h3>
        <p className="text-xs text-muted-foreground">{t('receiveStockHint')}</p>
        <RecordForm
          action={receiveStock.bind(null, item.id)}
          fields={receiveFields}
          initial={{ receivedAt: dateInputValue() }}
          locale={locale}
          submitLabel={t('receiveSubmit')}
          cancelHref={`/admin/records/inventory/${item.id}`}
          cancelLabel={t('cancel')}
          errors={receiveErrors}
        />
      </div>

      <div className="mt-4 space-y-2">
        <h3 className="text-sm font-semibold">{t('f.movements')}</h3>
        <DataTable columns={mCols} rows={mRows} emptyLabel={t('none')} />
      </div>
    </>
  );
}
