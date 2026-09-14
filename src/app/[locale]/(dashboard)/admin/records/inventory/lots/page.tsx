import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { formatDate } from '@/lib/dates';
import { formatNumber, formatQuantity } from '@/lib/money';
import { getPageContext } from '@/server/page-context';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import { getLotsViewData } from '@/server/inventory-v2/operations-read';

export default async function InventoryLotsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'manage:inventory');
  if (!getInventoryV2Config().enabled) notFound();
  const sp = await searchParams;
  const requestedLocationId = typeof sp.locationId === 'string' ? sp.locationId : undefined;
  const t = await getTranslations('records');
  const data = await getLotsViewData(user, requestedLocationId);
  const canViewCost = user.role === 'OWNER' || user.role === 'ADMIN';
  const columns: Column[] = [
    { label: t('inventoryV2.operations.item') },
    { label: t('inventoryV2.operations.lotNumber') },
    { label: t('inventoryV2.operations.quantity'), align: 'end' },
    { label: t('inventoryV2.operations.receivedDate') },
    { label: t('inventoryV2.operations.bestBefore') },
    ...(canViewCost ? [{ label: t('inventoryV2.operations.unitCost'), align: 'end' as const }] : []),
  ];
  const rows = data.lots.map((lot) => [
    locale === 'ar' ? lot.inventoryItem.nameAr : lot.inventoryItem.nameEn,
    lot.lotNumber ?? lot.supplierLot ?? lot.id,
    `${formatQuantity(lot.quantity, locale)} ${lot.inventoryItem.unit}`,
    formatDate(lot.receivedAt, locale),
    lot.bestBefore ? formatDate(lot.bestBefore, locale) : '—',
    ...(canViewCost ? [`${formatNumber(lot.unitCost, locale, 3)} IQD`] : []),
  ]);

  return (
    <>
      <BackLink href="/admin/records/inventory" label={t('back')} />
      <PageHeader title={t('inventoryV2.operations.lotsTitle')} subtitle={t('inventoryV2.operations.lotsHint')} />
      {data.locations.length ? (
        <form method="get" className="mb-4 max-w-xl rounded-lg border bg-card p-3">
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
            {t('inventoryV2.location')}
            <select name="locationId" defaultValue={data.location?.id ?? ''} className="min-h-10 rounded-lg border bg-background px-3 text-sm">
              {data.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {locale === 'ar' ? `${location.nameAr} · ${location.branch.nameAr}` : `${location.nameEn} · ${location.branch.nameEn}`}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="mt-3 min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">{t('inventoryV2.applyView')}</button>
        </form>
      ) : (
        <div className="mb-4"><EmptyState message={t('inventoryV2.noLocations')} /></div>
      )}
      <DataTable columns={columns} rows={rows} emptyLabel={t('none')} />
    </>
  );
}
