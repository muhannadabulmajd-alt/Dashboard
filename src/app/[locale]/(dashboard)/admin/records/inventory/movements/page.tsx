import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { formatDate } from '@/lib/dates';
import { enumLabel } from '@/lib/enums';
import { formatNumber, formatQuantity } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import { getPageContext } from '@/server/page-context';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import { getMovementHistoryData } from '@/server/inventory-v2/operations-read';

export default async function InventoryMovementsPage({
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
  const data = await getMovementHistoryData(user, requestedLocationId);
  const canViewCost = user.role === 'OWNER' || user.role === 'ADMIN';
  const columns: Column[] = [
    { label: t('inventoryV2.operations.date') },
    { label: t('inventoryV2.operations.item') },
    { label: t('inventoryV2.operations.movementReason') },
    { label: t('inventoryV2.operations.quantity'), align: 'end' },
    { label: t('inventoryV2.operations.document') },
    { label: t('inventoryV2.operations.reference') },
    { label: t('inventoryV2.operations.lotNumber') },
    ...(canViewCost ? [{ label: t('inventoryV2.operations.unitCost'), align: 'end' as const }] : []),
  ];
  const rows = data.movements.map((movement) => [
    formatDate(movement.occurredAt, locale),
    locale === 'ar' ? movement.inventoryItem.nameAr : movement.inventoryItem.nameEn,
    enumLabel(movement.reason, locale),
    <span key="quantity" className={Number(movement.quantity) < 0 ? 'font-semibold text-danger' : 'font-semibold text-success'}>
      {formatQuantity(movement.quantity, locale)} {movement.inventoryItem.unit}
    </span>,
    movement.stockDocument ? (
      <Link key="document" href={`/admin/records/inventory/documents/${movement.stockDocument.id}`} className="font-semibold text-primary hover:underline">
        {movement.stockDocument.documentNumber}
      </Link>
    ) : '—',
    movement.order?.orderNumber ?? movement.reference ?? '—',
    movement.costLayer?.lotNumber ?? '—',
    ...(canViewCost ? [movement.costLayer ? `${formatNumber(movement.costLayer.unitCost, locale, 3)} IQD` : '—'] : []),
  ]);

  return (
    <>
      <BackLink href="/admin/records/inventory" label={t('back')} />
      <PageHeader title={t('inventoryV2.operations.movementsTitle')} subtitle={t('inventoryV2.operations.movementsHint')} />
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
