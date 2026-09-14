import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { RecordActions } from '@/components/records/RecordActions';
import { StockDiscrepancyResolutionForm } from '@/components/records/StockDiscrepancyResolutionForm';
import { archiveBatch, deleteBatch } from '@/server/records/batches';
import { formatMoney, formatNumber, formatPercent, formatQuantity } from '@/lib/money';
import { dateInputValue, formatDate } from '@/lib/dates';
import { Link } from '@/i18n/navigation';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import { resolveStockDiscrepancyAction } from '@/server/inventory-v2/operations-actions';
import {
  resolveLocationObjectScope,
  roastBatchWhereForScope,
} from '@/server/inventory-v2/object-scope';

export default async function BatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'manage:batches');
  const { id } = await params;
  const t = await getTranslations('records');
  const inventoryV2Enabled = getInventoryV2Config().enabled;
  const scope = await resolveLocationObjectScope(user);
  const b = await prisma.roastBatch.findFirst({
    where: { id, ...roastBatchWhereForScope(scope) },
    include: {
      location: { select: { nameEn: true, nameAr: true, stockVersion: true } },
      stockDocument: {
        select: {
          id: true,
          documentNumber: true,
          status: true,
          discrepancies: {
            include: {
              inventoryItem: true,
              resolvedBy: { select: { name: true } },
              resolutionDocument: { select: { id: true, documentNumber: true } },
              financeEntry: { select: { id: true, amount: true, accountingCode: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });
  if (!b) notFound();

  const roasted = b.roastedOutputGrams != null;

  const items: DetailField[] = [
    { label: t('f.batchNumber'), value: b.batchNumber },
    { label: t('f.origin'), value: b.origin },
    {
      label: t('f.status'),
      value: (
        <Badge variant={roasted ? 'success' : 'warning'}>
          {roasted ? t('f.roasted') : t('f.pending')}
        </Badge>
      ),
    },
    { label: t('f.roastDate'), value: b.roastDate ? formatDate(b.roastDate, locale) : '—' },
    ...(inventoryV2Enabled
      ? [
          {
            label: t('inventoryV2.location'),
            value: b.location ? (locale === 'ar' ? b.location.nameAr : b.location.nameEn) : '—',
          },
          {
            label: t('inventoryV2.operations.document'),
            value: b.stockDocument ? (
              <Link href={`/admin/records/inventory/documents/${b.stockDocument.id}`} className="font-semibold text-primary hover:underline">
                {b.stockDocument.documentNumber}
              </Link>
            ) : '—',
          },
          {
            label: t('inventoryV2.operations.abnormalLoss'),
            value: `${formatNumber(b.abnormalLossGrams, locale)} g`,
          },
          {
            label: t('inventoryV2.operations.openDiscrepancies'),
            value: formatNumber(
              b.stockDocument?.discrepancies.filter((row) => row.status === 'OPEN').length ?? 0,
              locale,
            ),
          },
        ]
      : []),
    { label: t('f.roastLevel'), value: b.roastLevel ? enumLabel(b.roastLevel, locale) : '—' },
    { label: t('f.green'), value: formatNumber(b.greenInputGrams, locale) },
    {
      label: t('f.output'),
      value: b.roastedOutputGrams != null ? formatNumber(b.roastedOutputGrams, locale) : '—',
    },
    {
      label: t('f.yield'),
      value:
        b.roastedOutputGrams != null && b.greenInputGrams > 0
          ? formatPercent(b.roastedOutputGrams / b.greenInputGrams, locale)
          : '—',
    },
    {
      label: t('f.shrinkage'),
      value:
        b.roastedOutputGrams != null && b.greenInputGrams > 0
          ? formatPercent(1 - b.roastedOutputGrams / b.greenInputGrams, locale)
          : '—',
    },
    {
      label: t('f.qc'),
      value: b.qcScore != null ? formatNumber(b.qcScore, locale) : '—',
    },
  ];

  return (
    <>
      <BackLink href="/admin/records/batches" label={t('back')} />
      <PageHeader title={b.batchNumber} subtitle={b.origin} />
      <RecordActions
        editHref={inventoryV2Enabled ? undefined : `/admin/records/batches/${b.id}/edit`}
        isActive={inventoryV2Enabled ? undefined : b.isActive}
        archiveAction={inventoryV2Enabled ? undefined : archiveBatch.bind(null, b.id, locale, !b.isActive)}
        deleteAction={inventoryV2Enabled ? undefined : deleteBatch.bind(null, b.id, locale)}
        labels={{
          edit: t('edit'),
          archive: t('archive'),
          restore: t('restore'),
          delete: t('delete'),
          confirm: t('confirmDelete'),
        }}
      />
      <DetailGrid items={items} />
      {inventoryV2Enabled && b.stockDocument?.discrepancies.length ? (
        <section className="mt-5 space-y-3">
          <h2 className="text-base font-semibold">{t('inventoryV2.operations.discrepancyReview')}</h2>
          {b.stockDocument.discrepancies.map((discrepancy) => (
            <div key={discrepancy.id} className="space-y-3 rounded-lg border bg-card p-4">
              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><span className="text-muted-foreground">{t('inventoryV2.operations.item')}:</span> <strong>{locale === 'ar' ? discrepancy.inventoryItem.nameAr : discrepancy.inventoryItem.nameEn}</strong></div>
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
              {(user.role === 'OWNER' || user.role === 'ADMIN') && discrepancy.status === 'OPEN' && b.location ? (
                <StockDiscrepancyResolutionForm
                  action={resolveStockDiscrepancyAction.bind(
                    null,
                    discrepancy.id,
                    `/${locale}/admin/records/batches/${b.id}`,
                  )}
                  locale={locale}
                  idempotencyKey={`stock-discrepancy-review:${discrepancy.id}:${randomUUID()}`}
                  occurredAt={dateInputValue()}
                  expectedDiscrepancyVersion={discrepancy.version}
                  expectedLocationVersion={b.location.stockVersion}
                  type={discrepancy.type}
                  labels={{
                    decision: t('inventoryV2.operations.reviewDecision'),
                    approve: t('inventoryV2.operations.approveDiscrepancy'),
                    reject: t('inventoryV2.operations.rejectDiscrepancy'),
                    date: t('inventoryV2.operations.date'),
                    unitCost: t('inventoryV2.operations.approvedUnitCost'),
                    resolution: t('inventoryV2.operations.resolution'),
                  }}
                  errors={{
                    invalid_input: t('inventoryV2.operations.invalid'),
                    discrepancy_resolution_forbidden: t('inventoryV2.operations.forbidden'),
                    discrepancy_not_resolvable: t('inventoryV2.operations.discrepancyAlreadyReviewed'),
                    discrepancy_stock_stale: t('inventoryV2.operations.discrepancyStockStale'),
                    discrepancy_unit_cost_required: t('inventoryV2.operations.discrepancyUnitCostRequired'),
                    discrepancy_value_invalid: t('inventoryV2.operations.discrepancyValueInvalid'),
                    variance_policy_required: t('inventoryV2.operations.variancePolicyRequired'),
                    variance_account_code_required: t('inventoryV2.operations.varianceAccountRequired'),
                    location_stale: t('inventoryV2.operations.stale'),
                    document_stale: t('inventoryV2.operations.stale'),
                  }}
                />
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
