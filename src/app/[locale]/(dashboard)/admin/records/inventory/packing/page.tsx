import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PackingRunForm } from '@/components/records/PackingRunForm';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { dateInputValue, formatDate } from '@/lib/dates';
import { formatNumber, formatQuantity } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import { getPageContext } from '@/server/page-context';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import { packFinishedGoodsAction } from '@/server/inventory-v2/operations-actions';
import { getPackingIndexData } from '@/server/inventory-v2/operations-read';

export default async function PackingRunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'manage:inventory');
  if (!getInventoryV2Config().enabled) notFound();
  const t = await getTranslations('records');
  const data = await getPackingIndexData(user);
  const locations = data.locations.map((location) => ({
    id: location.id,
    label: locale === 'ar'
      ? `${location.nameAr} · ${location.branch.nameAr}`
      : `${location.nameEn} · ${location.branch.nameEn}`,
    stockVersion: location.stockVersion,
    outputs: location.outputs.map((output) => ({
      inventoryItemId: output.inventoryItem.id,
      productId: output.inventoryItem.productId!,
      recipeVersionId: output.recipe.id,
      label: `${output.recipe.product.sku} · ${locale === 'ar' ? output.recipe.product.nameAr : output.recipe.product.nameEn}`,
      unit: output.inventoryItem.unit,
      producible: output.availability.producible,
      recipeVersion: output.recipe.version,
    })),
  })).sort((left, right) => (
    left.id === user.defaultStockLocationId ? -1 : right.id === user.defaultStockLocationId ? 1 : 0
  ));
  const canViewCost = ['OWNER', 'ADMIN', 'FINANCE', 'ROASTERY_OPS'].includes(user.role);
  const columns: Column[] = [
    { label: t('inventoryV2.operations.packingBatch') },
    { label: t('inventoryV2.operations.packedAt') },
    { label: t('inventoryV2.operations.outputItem') },
    { label: t('inventoryV2.location') },
    { label: t('inventoryV2.operations.outputQuantity'), align: 'end' },
    { label: t('inventoryV2.operations.rejectedQuantity'), align: 'end' },
    ...(canViewCost ? [{ label: t('inventoryV2.operations.totalCost'), align: 'end' as const }] : []),
    { label: t('inventoryV2.operations.createdBy') },
    { label: '' },
  ];
  const rows = data.batches.map((batch) => [
    batch.batchNumber,
    formatDate(batch.packedAt, locale),
    `${batch.product.sku} · ${locale === 'ar' ? batch.product.nameAr : batch.product.nameEn}`,
    locale === 'ar' ? batch.location.nameAr : batch.location.nameEn,
    `${formatQuantity(batch.outputQuantity, locale)} ${batch.outputInventoryItem.unit}`,
    formatQuantity(batch.rejectedQuantity, locale),
    ...(canViewCost ? [`${formatNumber(batch.totalCost, locale, 3)} IQD`] : []),
    batch.operator?.name ?? '—',
    <Link key="open" href={`/admin/records/inventory/packing/${batch.id}`} className="font-semibold text-primary hover:underline">{t('open')}</Link>,
  ]);

  return (
    <>
      <BackLink href="/admin/records/inventory" label={t('back')} />
      <PageHeader title={t('inventoryV2.operations.packingTitle')} subtitle={t('inventoryV2.operations.packingHint')} />
      <section className="mb-5">
        <h2 className="mb-2 text-base font-semibold">{t('inventoryV2.operations.newPackingRun')}</h2>
        {locations.length ? (
          <PackingRunForm
            action={packFinishedGoodsAction}
            locale={locale}
            idempotencyKey={`packing-run:${randomUUID()}`}
            packedAt={dateInputValue()}
            locations={locations}
            labels={{
              location: t('inventoryV2.location'),
              outputItem: t('inventoryV2.operations.outputItem'),
              outputQuantity: t('inventoryV2.operations.outputQuantity'),
              rejectedQuantity: t('inventoryV2.operations.rejectedQuantity'),
              packedAt: t('inventoryV2.operations.packedAt'),
              bestBefore: t('inventoryV2.operations.bestBefore'),
              notes: t('inventoryV2.operations.notes'),
              recipeVersion: t('inventoryV2.operations.recipeVersion'),
              producible: t('inventoryV2.producible'),
              noOutputs: t('inventoryV2.operations.noPackingOutputs'),
              submit: t('inventoryV2.operations.postPackingRun'),
            }}
            errors={{
              invalid_input: t('inventoryV2.operations.invalid'),
              invalid_date: t('inventoryV2.operations.invalid'),
              forbidden: t('inventoryV2.operations.forbidden'),
              location_produce_forbidden: t('inventoryV2.operations.forbidden'),
              location_stale: t('inventoryV2.operations.stale'),
              inventory_location_not_configured: t('inventoryV2.operations.notConfigured'),
              stock_insufficient: t('inventoryV2.operations.insufficient'),
              packing_recipe_stale: t('inventoryV2.operations.recipeStale'),
              packing_output_not_sellable: t('inventoryV2.operations.outputNotSellable'),
            }}
          />
        ) : (
          <EmptyState message={t('inventoryV2.noLocations')} />
        )}
      </section>
      <DataTable columns={columns} rows={rows} emptyLabel={t('none')} />
    </>
  );
}
