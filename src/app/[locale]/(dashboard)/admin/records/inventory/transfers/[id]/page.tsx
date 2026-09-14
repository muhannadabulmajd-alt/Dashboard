import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { StockTransferReceiptForm } from '@/components/records/StockTransferForms';
import { StockDiscrepancyResolutionForm } from '@/components/records/StockDiscrepancyResolutionForm';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink, DetailGrid } from '@/components/records/parts';
import { Badge, Card, CardHeader, CardTitle, PageHeader } from '@/components/ui/primitives';
import { dateInputValue, formatDate } from '@/lib/dates';
import { enumLabel } from '@/lib/enums';
import { formatMoney, formatQuantity } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import { getPageContext } from '@/server/page-context';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import {
  receiveStockTransferAction,
  resolveStockDiscrepancyAction,
} from '@/server/inventory-v2/operations-actions';
import { getTransferDetailData } from '@/server/inventory-v2/operations-read';

export default async function StockTransferDetailPage({
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
  const data = await getTransferDetailData(user, id);
  if (!data) notFound();
  const { document } = data;
  const sourceName = document.sourceLocation
    ? (locale === 'ar' ? document.sourceLocation.nameAr : document.sourceLocation.nameEn)
    : '—';
  const destinationName = document.destinationLocation
    ? (locale === 'ar' ? document.destinationLocation.nameAr : document.destinationLocation.nameEn)
    : '—';
  const dispatchMovements = document.movements.filter((movement) => movement.reason === 'TRANSFER_OUT');
  const columns: Column[] = [
    { label: t('inventoryV2.operations.item') },
    { label: t('inventoryV2.operations.quantity'), align: 'end' },
    { label: t('inventoryV2.operations.lotNumber') },
  ];
  const rows = dispatchMovements.map((movement) => [
    locale === 'ar' ? movement.inventoryItem.nameAr : movement.inventoryItem.nameEn,
    `${formatQuantity(Math.abs(Number(movement.quantity)), locale)} ${movement.inventoryItem.unit}`,
    movement.costLayer?.lotNumber ?? '—',
  ]);
  const receiptColumns: Column[] = [
    { label: t('inventoryV2.operations.document') },
    { label: t('inventoryV2.operations.receivedAt') },
    { label: t('inventoryV2.operations.createdBy') },
    { label: t('inventoryV2.operations.lines'), align: 'end' },
    { label: t('inventoryV2.operations.discrepancy'), align: 'end' },
  ];
  const receiptDocuments = document.childDocuments.filter((child) => child.type === 'TRANSFER');
  const receiptRows = receiptDocuments.map((receipt) => [
    <Link key="document" href={`/admin/records/inventory/documents/${receipt.id}`} className="font-semibold text-primary hover:underline">
      {receipt.documentNumber}
    </Link>,
    formatDate(receipt.occurredAt, locale),
    receipt.createdBy?.name ?? '—',
    receipt.movements.filter((movement) => movement.reason === 'TRANSFER_IN').length,
    receipt.discrepancies.length,
  ]);
  const discrepancies = receiptDocuments.flatMap((receipt) => receipt.discrepancies.map((row) => ({
    ...row,
    receiptNumber: receipt.documentNumber,
  })));
  const formErrors = {
    invalid_input: t('inventoryV2.operations.invalid'),
    invalid_date: t('inventoryV2.operations.invalid'),
    forbidden: t('inventoryV2.operations.forbidden'),
    location_receive_forbidden: t('inventoryV2.operations.forbidden'),
    location_stale: t('inventoryV2.operations.stale'),
    document_stale: t('inventoryV2.operations.stale'),
    transfer_receipt_exceeds_dispatch: t('inventoryV2.operations.receiptExceeds'),
    transfer_not_receivable: t('inventoryV2.operations.fullyReceived'),
    inventory_location_not_configured: t('inventoryV2.operations.notConfigured'),
    transfer_discrepancy_item_invalid: t('inventoryV2.operations.discrepancyItemInvalid'),
    transfer_discrepancy_exceeds_outstanding: t('inventoryV2.operations.discrepancyExceedsOutstanding'),
    discrepancy_resolution_forbidden: t('inventoryV2.operations.forbidden'),
    discrepancy_not_resolvable: t('inventoryV2.operations.discrepancyAlreadyReviewed'),
    discrepancy_stock_stale: t('inventoryV2.operations.discrepancyStockStale'),
    discrepancy_unit_cost_required: t('inventoryV2.operations.discrepancyUnitCostRequired'),
    discrepancy_value_invalid: t('inventoryV2.operations.discrepancyValueInvalid'),
    variance_policy_required: t('inventoryV2.operations.variancePolicyRequired'),
    variance_account_code_required: t('inventoryV2.operations.varianceAccountRequired'),
  };

  return (
    <>
      <BackLink href="/admin/records/inventory/transfers" label={t('back')} />
      <PageHeader title={document.documentNumber} subtitle={t('inventoryV2.operations.transferDetail')} />
      <div className="mb-4">
        <Link href={`/admin/records/inventory/documents/${document.id}`} className="text-sm font-semibold text-primary hover:underline">
          {t('inventoryV2.operations.openStockDocument')}
        </Link>
      </div>
      <DetailGrid items={[
        { label: t('inventoryV2.operations.status'), value: <Badge>{enumLabel(document.status, locale)}</Badge> },
        { label: t('inventoryV2.operations.date'), value: formatDate(document.occurredAt, locale) },
        { label: t('inventoryV2.operations.source'), value: sourceName },
        { label: t('inventoryV2.operations.destination'), value: destinationName },
        { label: t('inventoryV2.operations.expectedDate'), value: document.expectedAt ? formatDate(document.expectedAt, locale) : '—' },
        { label: t('inventoryV2.operations.createdBy'), value: document.createdBy?.name ?? '—' },
        { label: t('inventoryV2.operations.notes'), value: document.notes ?? '—' },
        { label: t('inventoryV2.stockVersion'), value: document.destinationLocation?.stockVersion ?? '—' },
      ]} />

      <section className="mt-5">
        <h2 className="mb-2 text-base font-semibold">{t('inventoryV2.operations.items')}</h2>
        <DataTable columns={columns} rows={rows} emptyLabel={t('none')} />
      </section>

      <section className="mt-5">
        <h2 className="mb-2 text-base font-semibold">{t('inventoryV2.operations.receiptHistory')}</h2>
        <DataTable columns={receiptColumns} rows={receiptRows} emptyLabel={t('none')} />
      </section>

      {discrepancies.length ? (
        <section className="mt-5 space-y-3">
          <h2 className="text-base font-semibold">{t('inventoryV2.operations.discrepancyReview')}</h2>
          {discrepancies.map((discrepancy) => {
            const itemName = locale === 'ar'
              ? discrepancy.inventoryItem.nameAr
              : discrepancy.inventoryItem.nameEn;
            const expectedLocationVersion = discrepancy.type === 'EXCESS'
              ? document.destinationLocation?.stockVersion
              : data.transit?.stockVersion;
            return (
              <div key={discrepancy.id} className="space-y-3 rounded-lg border bg-card p-4">
                <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div><span className="text-muted-foreground">{t('inventoryV2.operations.document')}:</span> <strong>{discrepancy.receiptNumber}</strong></div>
                  <div><span className="text-muted-foreground">{t('inventoryV2.operations.item')}:</span> <strong>{itemName}</strong></div>
                  <div><span className="text-muted-foreground">{t('inventoryV2.operations.discrepancy')}:</span> <strong>{enumLabel(discrepancy.type, locale)}</strong></div>
                  <div><span className="text-muted-foreground">{t('inventoryV2.operations.quantity')}:</span> <strong>{formatQuantity(discrepancy.quantity, locale)} {discrepancy.inventoryItem.unit}</strong></div>
                  <div><span className="text-muted-foreground">{t('inventoryV2.operations.status')}:</span> <Badge variant={discrepancy.status === 'RESOLVED' ? 'success' : discrepancy.status === 'REJECTED' ? 'danger' : 'warning'}>{enumLabel(discrepancy.status, locale)}</Badge></div>
                  <div className="sm:col-span-2"><span className="text-muted-foreground">{t('inventoryV2.operations.discrepancyNotes')}:</span> {discrepancy.notes ?? '—'}</div>
                  {discrepancy.resolution ? <div className="sm:col-span-2"><span className="text-muted-foreground">{t('inventoryV2.operations.resolution')}:</span> {discrepancy.resolution}</div> : null}
                </div>
                {discrepancy.financeEntry ? (
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span>{formatMoney(discrepancy.financeEntry.amount, 'IQD', locale)} · {discrepancy.financeEntry.accountingCode ?? '—'}</span>
                    <Link href={`/finance/ledger/${discrepancy.financeEntry.id}`} className="font-semibold text-primary hover:underline">
                      {t('open')}
                    </Link>
                  </div>
                ) : null}
                {data.canResolveDiscrepancies && discrepancy.status === 'OPEN' && expectedLocationVersion ? (
                  <StockDiscrepancyResolutionForm
                    action={resolveStockDiscrepancyAction.bind(
                      null,
                      discrepancy.id,
                      `/${locale}/admin/records/inventory/transfers/${document.id}`,
                    )}
                    locale={locale}
                    idempotencyKey={`stock-discrepancy-review:${discrepancy.id}:${randomUUID()}`}
                    occurredAt={dateInputValue()}
                    expectedDiscrepancyVersion={discrepancy.version}
                    expectedLocationVersion={expectedLocationVersion}
                    type={discrepancy.type}
                    defaultUnitCost={discrepancy.inventoryItem.unitCost ? Number(discrepancy.inventoryItem.unitCost) : null}
                    labels={{
                      decision: t('inventoryV2.operations.reviewDecision'),
                      approve: t('inventoryV2.operations.approveDiscrepancy'),
                      reject: t('inventoryV2.operations.rejectDiscrepancy'),
                      date: t('inventoryV2.operations.date'),
                      unitCost: t('inventoryV2.operations.approvedUnitCost'),
                      resolution: t('inventoryV2.operations.resolution'),
                    }}
                    errors={formErrors}
                  />
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {data.outstanding.length ? (
        <section className="mt-5">
          <h2 className="mb-2 text-base font-semibold">{t('inventoryV2.operations.receiveTransfer')}</h2>
          {data.canReceive && data.transit && document.destinationLocationId && document.destinationLocation ? (
            <StockTransferReceiptForm
              action={receiveStockTransferAction.bind(null, document.id)}
              locale={locale}
              idempotencyKey={`transfer-receive:${randomUUID()}`}
              occurredAt={dateInputValue()}
              destinationLocationId={document.destinationLocationId}
              expectedDestinationVersion={document.destinationLocation.stockVersion}
              expectedTransitVersion={data.transit.stockVersion}
              expectedDocumentVersion={document.version}
              initialLines={data.outstanding.map((item) => ({
                inventoryItemId: item.id,
                label: locale === 'ar' ? item.nameAr : item.nameEn,
                unit: item.unit,
                outstanding: item.quantity,
              }))}
              labels={{
                receivedAt: t('inventoryV2.operations.receivedAt'),
                outstanding: t('inventoryV2.operations.outstanding'),
                receivedQuantity: t('inventoryV2.operations.receivedQuantity'),
                discrepancy: t('inventoryV2.operations.discrepancy'),
                discrepancyQuantity: t('inventoryV2.operations.discrepancyQuantity'),
                discrepancyNotes: t('inventoryV2.operations.discrepancyNotes'),
                shortage: t('inventoryV2.operations.shortage'),
                damage: t('inventoryV2.operations.damage'),
                excess: t('inventoryV2.operations.excess'),
                notes: t('inventoryV2.operations.notes'),
                receive: t('inventoryV2.operations.receive'),
              }}
              errors={formErrors}
            />
          ) : (
            <Card variant="accent">
              <CardHeader><CardTitle>{t('inventoryV2.operations.notAuthorizedToReceive')}</CardTitle></CardHeader>
            </Card>
          )}
        </section>
      ) : (
        <Card variant="success" className="mt-5">
          <CardHeader><CardTitle>{t('inventoryV2.operations.fullyReceived')}</CardTitle></CardHeader>
        </Card>
      )}
    </>
  );
}
