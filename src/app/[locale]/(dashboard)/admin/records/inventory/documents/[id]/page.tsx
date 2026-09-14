import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { StockDocumentReversalForm } from '@/components/records/StockDocumentReversalForm';
import { BackLink, DetailGrid } from '@/components/records/parts';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { dateInputValue, formatDate } from '@/lib/dates';
import { enumLabel } from '@/lib/enums';
import { formatQuantity } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import { getPageContext } from '@/server/page-context';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import { reverseStockDocumentAction } from '@/server/inventory-v2/operations-actions';
import { getStockDocumentDetailData } from '@/server/inventory-v2/operations-read';

export default async function StockDocumentDetailPage({
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
  const data = await getStockDocumentDetailData(user, id);
  if (!data) notFound();
  const { document } = data;
  const ownerAdmin = user.role === 'OWNER' || user.role === 'ADMIN';
  const locationLabel = (location: typeof document.sourceLocation) => location
    ? `${locale === 'ar' ? location.nameAr : location.nameEn} · ${locale === 'ar' ? location.branch.nameAr : location.branch.nameEn}`
    : '—';
  const movementColumns: Column[] = [
    { label: t('inventoryV2.operations.item') },
    { label: t('inventoryV2.location') },
    { label: t('inventoryV2.operations.movementReason') },
    { label: t('inventoryV2.operations.quantity'), align: 'end' },
    { label: t('inventoryV2.operations.lotNumber') },
    { label: t('inventoryV2.operations.reference') },
  ];
  const movementRows = document.movements.map((movement) => [
    locale === 'ar' ? movement.inventoryItem.nameAr : movement.inventoryItem.nameEn,
    movement.location ? (locale === 'ar' ? movement.location.nameAr : movement.location.nameEn) : '—',
    enumLabel(movement.reason, locale),
    <span key="quantity" className={Number(movement.quantity) < 0 ? 'font-semibold text-danger' : 'font-semibold text-success'}>
      {formatQuantity(movement.quantity, locale)} {movement.inventoryItem.unit}
    </span>,
    movement.costLayer?.lotNumber ?? '—',
    movement.financeEntry ? (
      <Link key="finance" href={`/finance/ledger/${movement.financeEntry.id}`} className="font-semibold text-primary hover:underline">
        {movement.financeEntry.recordKey ?? movement.financeEntry.reference ?? t('open')}
      </Link>
    ) : movement.order ? (
      <Link key="order" href={`/admin/records/orders/${movement.order.id}`} className="font-semibold text-primary hover:underline">
        {movement.order.orderNumber}
      </Link>
    ) : movement.reference ?? '—',
  ]);
  const related = [
    ...(document.parentDocument ? [document.parentDocument] : []),
    ...(document.reversalOf ? [document.reversalOf] : []),
    ...(document.reversedByDocument ? [document.reversedByDocument] : []),
    ...document.childDocuments,
  ].filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index);
  const reversalBlockMessages: Record<string, string> = {
    stock_document_reversal_forbidden: t('inventoryV2.operations.forbidden'),
    stock_document_not_reversible: t('inventoryV2.operations.reversalNotAllowed'),
    stock_document_has_dependents: t('inventoryV2.operations.reversalHasDependents'),
    stock_document_has_discrepancies: t('inventoryV2.operations.reversalHasDiscrepancies'),
    stock_document_requires_domain_reversal: t('inventoryV2.operations.reversalRequiresWorkflow'),
    stock_document_location_missing: t('inventoryV2.operations.reversalLocationMissing'),
  };

  return (
    <>
      <BackLink href="/admin/records/inventory/movements" label={t('back')} />
      <PageHeader title={document.documentNumber} subtitle={t('inventoryV2.operations.stockDocumentDetail')} />
      <DetailGrid items={[
        { label: t('inventoryV2.operations.documentType'), value: enumLabel(document.type, locale) },
        { label: t('inventoryV2.operations.status'), value: <Badge variant={document.status === 'REVERSED' ? 'danger' : 'success'}>{enumLabel(document.status, locale)}</Badge> },
        { label: t('inventoryV2.operations.date'), value: formatDate(document.occurredAt, locale) },
        { label: t('inventoryV2.operations.source'), value: locationLabel(document.sourceLocation) },
        { label: t('inventoryV2.operations.destination'), value: locationLabel(document.destinationLocation) },
        { label: t('inventoryV2.operations.createdBy'), value: document.createdBy?.name ?? '—' },
        { label: t('inventoryV2.operations.confirmedBy'), value: document.confirmedBy?.name ?? '—' },
        { label: t('f.party'), value: document.party?.name ?? '—' },
        { label: t('inventoryV2.operations.reason'), value: document.reason ?? '—' },
        { label: t('inventoryV2.operations.notes'), value: document.notes ?? '—' },
      ]} />

      <section className="mt-5">
        <h2 className="mb-2 text-base font-semibold">{t('inventoryV2.operations.movements')}</h2>
        <DataTable columns={movementColumns} rows={movementRows} emptyLabel={t('none')} />
      </section>

      {related.length ? (
        <section className="mt-5">
          <h2 className="mb-2 text-base font-semibold">{t('inventoryV2.operations.relatedDocuments')}</h2>
          <div className="flex flex-wrap gap-2">
            {related.map((relatedDocument) => (
              <Link
                key={relatedDocument.id}
                href={`/admin/records/inventory/documents/${relatedDocument.id}`}
                className="rounded-lg border bg-card px-3 py-2 text-sm font-semibold text-primary hover:bg-muted"
              >
                {relatedDocument.documentNumber} · {enumLabel(relatedDocument.type, locale)}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {ownerAdmin ? (
        <section className="mt-6">
          {data.canReverse ? (
            <StockDocumentReversalForm
              action={reverseStockDocumentAction.bind(null, document.id)}
              locale={locale}
              documentNumber={document.documentNumber}
              occurredAt={dateInputValue()}
              idempotencyKey={`stock-reversal:${document.id}:${randomUUID()}`}
              expectedDocumentVersion={document.version}
              expectedLocationVersions={data.expectedLocationVersions}
              labels={{
                title: t('inventoryV2.operations.reverseDocument'),
                hint: t('inventoryV2.operations.reverseDocumentHint'),
                date: t('inventoryV2.operations.date'),
                confirmation: t('inventoryV2.operations.confirmDocumentNumber'),
                reason: t('inventoryV2.operations.reversalReason'),
                submit: t('inventoryV2.operations.reverseDocumentSubmit'),
              }}
              errors={{
                invalid_input: t('inventoryV2.operations.invalid'),
                stock_document_confirmation_mismatch: t('inventoryV2.operations.reversalConfirmationMismatch'),
                stock_document_reversal_forbidden: t('inventoryV2.operations.forbidden'),
                stock_document_not_reversible: t('inventoryV2.operations.reversalNotAllowed'),
                stock_document_already_reversed: t('inventoryV2.operations.reversalAlreadyPosted'),
                stock_document_has_dependents: t('inventoryV2.operations.reversalHasDependents'),
                stock_document_has_discrepancies: t('inventoryV2.operations.reversalHasDiscrepancies'),
                stock_document_requires_domain_reversal: t('inventoryV2.operations.reversalRequiresWorkflow'),
                stock_document_output_consumed: t('inventoryV2.operations.reversalOutputConsumed'),
                stock_document_output_reserved_or_consumed: t('inventoryV2.operations.reversalOutputReserved'),
                stock_finance_not_reversible: t('inventoryV2.operations.reversalFinanceBlocked'),
                stock_finance_shared_dependency: t('inventoryV2.operations.reversalFinanceBlocked'),
                location_stale: t('inventoryV2.operations.stale'),
                document_stale: t('inventoryV2.operations.stale'),
              }}
            />
          ) : (
            <EmptyState message={reversalBlockMessages[data.reversalBlockCode ?? ''] ?? t('inventoryV2.operations.reversalNotAllowed')} />
          )}
        </section>
      ) : null}
    </>
  );
}
