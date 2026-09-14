import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ReturnedGoodsDispositionForm } from '@/components/records/ReturnedGoodsForms';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink, DetailGrid } from '@/components/records/parts';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { dateInputValue, formatDate } from '@/lib/dates';
import { enumLabel } from '@/lib/enums';
import { formatQuantity } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import { getPageContext } from '@/server/page-context';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import { disposeReturnedGoodsAction } from '@/server/inventory-v2/operations-actions';
import { getReturnDetailData } from '@/server/inventory-v2/operations-read';

export default async function ReturnedGoodsDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'manage:inventory');
  if (!getInventoryV2Config().enabled) notFound();
  const { id } = await params;
  const t = await getTranslations('records');
  const data = await getReturnDetailData(user, id);
  if (!data) notFound();
  const { document } = data;
  const firstMovement = document.movements[0];
  const orderNumber = firstMovement?.order?.orderNumber ?? '—';
  const itemRows = document.movements.map((movement) => [
    locale === 'ar' ? movement.inventoryItem.nameAr : movement.inventoryItem.nameEn,
    `${formatQuantity(movement.quantity, locale)} ${movement.inventoryItem.unit}`,
    movement.costLayer?.lotNumber ?? '—',
  ]);
  const historyRows = document.childDocuments.map((child) => [
    <Link key="document" href={`/admin/records/inventory/documents/${child.id}`} className="font-semibold text-primary hover:underline">
      {child.documentNumber}
    </Link>,
    formatDate(child.occurredAt, locale),
    child.returnDisposition ? enumLabel(child.returnDisposition, locale) : enumLabel(child.type, locale),
    child.destinationLocation
      ? (locale === 'ar' ? child.destinationLocation.nameAr : child.destinationLocation.nameEn)
      : child.party?.name ?? '—',
    formatQuantity(child.movements.reduce((sum, movement) => sum + Math.abs(Number(movement.quantity)), 0), locale),
    child.createdBy?.name ?? '—',
  ]);
  const byItem = new Map<string, {
    inventoryItemId: string;
    label: string;
    unit: string;
    quantity: number;
  }>();
  for (const lot of data.outstanding) {
    const row = byItem.get(lot.inventoryItemId) ?? {
      inventoryItemId: lot.inventoryItemId,
      label: locale === 'ar' ? lot.inventoryItem.nameAr : lot.inventoryItem.nameEn,
      unit: lot.inventoryItem.unit,
      quantity: 0,
    };
    row.quantity += lot.quantity;
    byItem.set(lot.inventoryItemId, row);
  }
  const outstandingItems = [...byItem.values()].map((row) => ({
    ...row,
    quantity: Number(row.quantity.toFixed(3)),
  }));
  const formErrors = {
    invalid_input: t('inventoryV2.operations.invalid'),
    invalid_date: t('inventoryV2.operations.invalid'),
    forbidden: t('inventoryV2.operations.forbidden'),
    return_disposition_forbidden: t('inventoryV2.operations.forbidden'),
    location_approve_forbidden: t('inventoryV2.operations.forbidden'),
    location_stale: t('inventoryV2.operations.stale'),
    document_stale: t('inventoryV2.operations.stale'),
    return_disposition_exceeds_quarantine: t('inventoryV2.operations.dispositionExceeds'),
    return_destination_branch_mismatch: t('inventoryV2.operations.destinationBranchMismatch'),
    return_repack_location_required: t('inventoryV2.operations.repackLocationRequired'),
    return_supplier_not_found: t('inventoryV2.operations.supplierRequired'),
    return_source_location_missing: t('inventoryV2.operations.notFound'),
    inventory_location_not_configured: t('inventoryV2.operations.notConfigured'),
    inventory_not_sellable_here: t('inventoryV2.operations.outputNotSellable'),
    inventory_not_producible_here: t('inventoryV2.operations.notConfigured'),
    variance_policy_required: t('inventoryV2.operations.variancePolicyRequired'),
    variance_account_code_required: t('inventoryV2.operations.varianceAccountRequired'),
    discrepancy_value_invalid: t('inventoryV2.operations.discrepancyValueInvalid'),
  };

  return (
    <>
      <BackLink href="/admin/records/inventory/returns" label={t('back')} />
      <PageHeader title={document.documentNumber} subtitle={t('inventoryV2.operations.returnDetail')} />
      <div className="mb-4">
        <Link href={`/admin/records/inventory/documents/${document.id}`} className="text-sm font-semibold text-primary hover:underline">
          {t('inventoryV2.operations.openStockDocument')}
        </Link>
      </div>
      <DetailGrid items={[
        { label: t('inventoryV2.operations.status'), value: <Badge variant={outstandingItems.length ? 'warning' : 'success'}>{t(`inventoryV2.operations.${outstandingItems.length ? 'quarantined' : 'resolved'}`)}</Badge> },
        { label: t('inventoryV2.operations.date'), value: formatDate(document.occurredAt, locale) },
        { label: t('f.order'), value: orderNumber },
        { label: t('inventoryV2.operations.source'), value: document.sourceLocation ? (locale === 'ar' ? document.sourceLocation.nameAr : document.sourceLocation.nameEn) : '—' },
        { label: t('inventoryV2.quarantine'), value: locale === 'ar' ? document.destinationLocation!.nameAr : document.destinationLocation!.nameEn },
        { label: t('inventoryV2.operations.createdBy'), value: document.createdBy?.name ?? '—' },
        { label: t('inventoryV2.operations.reason'), value: document.reason ?? '—' },
      ]} />

      <section className="mt-5">
        <h2 className="mb-2 text-base font-semibold">{t('inventoryV2.operations.returnedItems')}</h2>
        <DataTable
          columns={[
            { label: t('inventoryV2.operations.item') },
            { label: t('inventoryV2.operations.returnedQuantity'), align: 'end' },
            { label: t('inventoryV2.operations.lotNumber') },
          ] satisfies Column[]}
          rows={itemRows}
          emptyLabel={t('none')}
        />
      </section>

      <section className="mt-5">
        <h2 className="mb-2 text-base font-semibold">{t('inventoryV2.operations.dispositionHistory')}</h2>
        <DataTable
          columns={[
            { label: t('inventoryV2.operations.document') },
            { label: t('inventoryV2.operations.date') },
            { label: t('inventoryV2.operations.disposition') },
            { label: t('inventoryV2.operations.destination') },
            { label: t('inventoryV2.operations.quantity'), align: 'end' },
            { label: t('inventoryV2.operations.createdBy') },
          ] satisfies Column[]}
          rows={historyRows}
          emptyLabel={t('none')}
        />
      </section>

      <section className="mt-5">
        <h2 className="mb-2 text-base font-semibold">{t('inventoryV2.operations.disposeReturn')}</h2>
        {outstandingItems.length && data.canDispose ? (
          <ReturnedGoodsDispositionForm
            action={disposeReturnedGoodsAction}
            locale={locale}
            idempotencyKey={`return-disposition:${randomUUID()}`}
            occurredAt={dateInputValue()}
            returnDocumentId={document.id}
            expectedQuarantineVersion={data.quarantineStockVersion}
            expectedReturnDocumentVersion={data.returnDocumentVersion}
            items={outstandingItems}
            locations={data.destinationLocations.map((location) => ({
              id: location.id,
              label: locale === 'ar'
                ? `${location.nameAr} · ${location.branch.nameAr}`
                : `${location.nameEn} · ${location.branch.nameEn}`,
              type: location.type,
              stockVersion: location.stockVersion,
              policies: location.policies.map((policy) => ({
                inventoryItemId: policy.inventoryItemId,
                canSell: policy.canSell,
                canProduce: policy.canProduce,
              })),
            }))}
            suppliers={data.suppliers.map((supplier) => ({ id: supplier.id, label: supplier.name }))}
            labels={{
              item: t('inventoryV2.operations.item'),
              quantity: t('inventoryV2.operations.quantity'),
              outstanding: t('inventoryV2.operations.outstanding'),
              disposition: t('inventoryV2.operations.disposition'),
              restock: t('inventoryV2.operations.restock'),
              repack: t('inventoryV2.operations.repack'),
              returnToSupplier: t('inventoryV2.operations.returnToSupplier'),
              waste: t('inventoryV2.operations.waste'),
              destination: t('inventoryV2.operations.destination'),
              supplier: t('f.party'),
              date: t('inventoryV2.operations.date'),
              reason: t('inventoryV2.operations.reason'),
              noDestination: t('inventoryV2.operations.noDispositionDestination'),
              submit: t('inventoryV2.operations.postDisposition'),
            }}
            errors={formErrors}
          />
        ) : (
          <EmptyState message={outstandingItems.length ? t('inventoryV2.operations.notAuthorizedToDispose') : t('inventoryV2.operations.returnResolved')} />
        )}
      </section>
    </>
  );
}
