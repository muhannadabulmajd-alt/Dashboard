import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { StockTransferDispatchForm } from '@/components/records/StockTransferForms';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { dateInputValue, formatDate } from '@/lib/dates';
import { enumLabel } from '@/lib/enums';
import { formatQuantity } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import { getPageContext } from '@/server/page-context';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import { dispatchStockTransferAction } from '@/server/inventory-v2/operations-actions';
import { getTransferIndexData } from '@/server/inventory-v2/operations-read';

export default async function StockTransfersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'manage:inventory');
  if (!getInventoryV2Config().enabled) notFound();
  const t = await getTranslations('records');
  const data = await getTransferIndexData(user);
  const locationLabel = (location: { nameEn: string; nameAr: string; branch: { code: string; nameEn: string; nameAr: string } }) => (
    locale === 'ar'
      ? `${location.nameAr} · ${location.branch.nameAr}`
      : `${location.nameEn} · ${location.branch.nameEn}`
  );
  const sourceLocations = data.sources.map((location) => ({
    id: location.id,
    label: locationLabel(location),
    stockVersion: location.stockVersion,
    transitVersion: location.transitVersion,
    itemIds: location.policies.map((policy) => policy.inventoryItemId),
    items: location.items.map((item) => ({
      id: item.id,
      label: `${locale === 'ar' ? item.nameAr : item.nameEn}${item.externalKey ? ` · ${item.externalKey}` : ''}`,
      unit: item.unit,
      available: item.availability.available,
    })),
  }));
  const destinationLocations = data.destinations.map((location) => ({
    id: location.id,
    label: locationLabel(location),
    stockVersion: location.stockVersion,
    transitVersion: location.transitVersion,
    itemIds: location.policies.map((policy) => policy.inventoryItemId),
    items: [],
  }));
  const columns: Column[] = [
    { label: t('inventoryV2.operations.document') },
    { label: t('inventoryV2.operations.date') },
    { label: t('inventoryV2.operations.source') },
    { label: t('inventoryV2.operations.destination') },
    { label: t('inventoryV2.operations.lines'), align: 'end' },
    { label: t('inventoryV2.operations.status') },
    { label: t('inventoryV2.operations.createdBy') },
    { label: '' },
  ];
  const rows = data.documents.map((document) => {
    const itemCount = new Set(document.movements.map((movement) => movement.inventoryItemId)).size;
    const quantity = document.movements.reduce((sum, movement) => sum + Math.abs(Number(movement.quantity)), 0);
    const badge = document.status === 'RECEIVED'
      ? 'success'
      : document.status === 'PARTIALLY_RECEIVED'
        ? 'warning'
        : document.status === 'CANCELLED' || document.status === 'REJECTED'
          ? 'danger'
          : 'default';
    return [
      document.documentNumber,
      formatDate(document.occurredAt, locale),
      document.sourceLocation ? (locale === 'ar' ? document.sourceLocation.nameAr : document.sourceLocation.nameEn) : '—',
      document.destinationLocation ? (locale === 'ar' ? document.destinationLocation.nameAr : document.destinationLocation.nameEn) : '—',
      `${itemCount} · ${formatQuantity(quantity, locale)}`,
      <Badge key="status" variant={badge}>{enumLabel(document.status, locale)}</Badge>,
      document.createdBy?.name ?? '—',
      <Link key="open" href={`/admin/records/inventory/transfers/${document.id}`} className="font-semibold text-primary hover:underline">
        {t('open')}
      </Link>,
    ];
  });
  const formLabels = {
    source: t('inventoryV2.operations.source'),
    destination: t('inventoryV2.operations.destination'),
    date: t('inventoryV2.operations.date'),
    expectedDate: t('inventoryV2.operations.expectedDate'),
    items: t('inventoryV2.operations.items'),
    item: t('inventoryV2.operations.item'),
    quantity: t('inventoryV2.operations.quantity'),
    available: t('inventoryV2.operations.available'),
    addLine: t('inventoryV2.operations.addLine'),
    removeLine: t('inventoryV2.operations.removeLine'),
    noSharedItems: t('inventoryV2.operations.noSharedItems'),
    notes: t('inventoryV2.operations.notes'),
    dispatch: t('inventoryV2.operations.dispatch'),
  };
  const formErrors = {
    invalid_input: t('inventoryV2.operations.invalid'),
    invalid_date: t('inventoryV2.operations.invalid'),
    forbidden: t('inventoryV2.operations.forbidden'),
    location_forbidden: t('inventoryV2.operations.forbidden'),
    location_dispatch_forbidden: t('inventoryV2.operations.forbidden'),
    location_stale: t('inventoryV2.operations.stale'),
    transfer_same_location: t('inventoryV2.operations.sameLocation'),
    transit_location_missing: t('inventoryV2.operations.transitMissing'),
    inventory_location_not_configured: t('inventoryV2.operations.notConfigured'),
    stock_insufficient: t('inventoryV2.operations.insufficient'),
  };

  return (
    <>
      <BackLink href="/admin/records/inventory" label={t('back')} />
      <PageHeader title={t('inventoryV2.operations.transferTitle')} subtitle={t('inventoryV2.operations.transferHint')} />
      {sourceLocations.length && destinationLocations.length > 1 ? (
        <section className="mb-5">
          <h2 className="mb-2 text-base font-semibold">{t('inventoryV2.operations.newTransfer')}</h2>
          <StockTransferDispatchForm
            action={dispatchStockTransferAction}
            locale={locale}
            idempotencyKey={`transfer-dispatch:${randomUUID()}`}
            occurredAt={dateInputValue()}
            sourceLocations={sourceLocations}
            destinationLocations={destinationLocations}
            labels={formLabels}
            errors={formErrors}
          />
        </section>
      ) : (
        <div className="mb-5">
          <EmptyState message={t('inventoryV2.operations.noSharedItems')} />
        </div>
      )}
      <DataTable columns={columns} rows={rows} emptyLabel={t('none')} />
    </>
  );
}
