import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  InventoryCountApprovalForm,
  InventoryCountRejectionForm,
} from '@/components/records/InventoryCountForms';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink, DetailGrid } from '@/components/records/parts';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { dateInputValue, formatDate } from '@/lib/dates';
import { enumLabel } from '@/lib/enums';
import { formatMoney, formatQuantity } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import { getPageContext } from '@/server/page-context';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import {
  approveInventoryCountAction,
  rejectInventoryCountAction,
} from '@/server/inventory-v2/operations-actions';
import { getCountDetailData } from '@/server/inventory-v2/operations-read';

export default async function InventoryCountDetailPage({
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
  const data = await getCountDetailData(user, id);
  if (!data) notFound();
  const { count } = data;
  const columns: Column[] = [
    { label: t('inventoryV2.operations.item') },
    { label: t('inventoryV2.operations.expected'), align: 'end' },
    { label: t('inventoryV2.operations.counted'), align: 'end' },
    { label: t('inventoryV2.operations.difference'), align: 'end' },
    { label: t('inventoryV2.operations.notes') },
  ];
  const rows = count.lines.map((line) => [
    locale === 'ar' ? line.inventoryItem.nameAr : line.inventoryItem.nameEn,
    `${formatQuantity(line.expectedQuantity, locale)} ${line.inventoryItem.unit}`,
    `${formatQuantity(line.countedQuantity, locale)} ${line.inventoryItem.unit}`,
    <span key="difference" className={Number(line.difference) === 0 ? '' : Number(line.difference) > 0 ? 'font-semibold text-success' : 'font-semibold text-danger'}>
      {formatQuantity(line.difference, locale)}
    </span>,
    line.notes ?? '—',
  ]);

  return (
    <>
      <BackLink href="/admin/records/inventory/counts" label={t('back')} />
      <PageHeader title={count.countNumber} subtitle={t('inventoryV2.operations.countTitle')} />
      <DetailGrid items={[
        { label: t('inventoryV2.operations.status'), value: <Badge variant={count.status === 'APPROVED' ? 'success' : 'warning'}>{enumLabel(count.status, locale)}</Badge> },
        { label: t('inventoryV2.operations.countKind'), value: enumLabel(count.kind, locale) },
        { label: t('inventoryV2.location'), value: locale === 'ar' ? count.location.nameAr : count.location.nameEn },
        { label: t('f.branch'), value: locale === 'ar' ? count.location.branch.nameAr : count.location.branch.nameEn },
        { label: t('inventoryV2.operations.countedAt'), value: formatDate(count.countedAt, locale) },
        { label: t('inventoryV2.operations.submittedBy'), value: count.submittedBy.name },
        { label: t('inventoryV2.operations.approvedBy'), value: count.approvedBy?.name ?? '—' },
        ...(count.status === 'REJECTED' ? [
          { label: t('inventoryV2.operations.rejectedBy'), value: count.rejectedBy?.name ?? '—' },
          { label: t('inventoryV2.operations.rejectionReason'), value: count.rejectionReason ?? '—' },
        ] : []),
        { label: t('inventoryV2.operations.reason'), value: count.reason ?? '—' },
        ...(count.kind === 'OPENING' ? [{
          label: t('inventoryV2.operations.openingSigned'),
          value: count.openingAttestedAt
            ? `${count.submittedBy.name} · ${formatDate(count.openingAttestedAt, locale)}`
            : t('inventoryV2.no'),
        }] : []),
        { label: t('inventoryV2.stockVersion'), value: count.location.stockVersion },
      ]} />
      <section className="mt-5">
        <DataTable columns={columns} rows={rows} emptyLabel={t('none')} />
      </section>
      {count.financeEntries.length ? (
        <section className="mt-5 space-y-2">
          <h2 className="text-base font-semibold">{t('inventoryV2.operations.accountingEntries')}</h2>
          <DataTable
            columns={[
              { label: t('f.type') },
              { label: t('inventoryV2.operations.accountCode') },
              { label: t('f.amount'), align: 'end' },
              { label: '' },
            ]}
            rows={count.financeEntries.map((entry) => [
              enumLabel(entry.type, locale),
              entry.accountingCode ?? '—',
              formatMoney(entry.amount, 'IQD', locale),
              <Link key={entry.id} href={`/finance/ledger/${entry.id}`} className="font-semibold text-primary hover:underline">
                {t('open')}
              </Link>,
            ])}
            emptyLabel={t('none')}
          />
        </section>
      ) : null}
      {data.canApprove ? (
        <section className="mt-5">
          <h2 className="mb-1 text-base font-semibold">{t('inventoryV2.operations.approveCount')}</h2>
          <p className="mb-3 text-sm text-muted-foreground">{t('inventoryV2.operations.approvalWarning')}</p>
          <InventoryCountApprovalForm
            action={approveInventoryCountAction.bind(null, count.id)}
            locale={locale}
            idempotencyKey={`inventory-count-approval:${count.id}:${randomUUID()}`}
            occurredAt={dateInputValue()}
            expectedLocationVersion={count.location.stockVersion}
            expectedCountVersion={count.version}
            labels={{
              date: t('inventoryV2.operations.date'),
              reason: t('inventoryV2.operations.reason'),
              approve: t('inventoryV2.operations.approveCount'),
            }}
            errors={{
              invalid_input: t('inventoryV2.operations.invalid'),
              invalid_date: t('inventoryV2.operations.invalid'),
              count_approval_forbidden: t('inventoryV2.operations.forbidden'),
              count_not_approvable: t('inventoryV2.operations.invalid'),
              location_approve_forbidden: t('inventoryV2.operations.forbidden'),
              location_stale: t('inventoryV2.operations.stale'),
              document_stale: t('inventoryV2.operations.stale'),
              count_stock_stale: t('inventoryV2.operations.countStockStale'),
              opening_count_not_attested: t('inventoryV2.operations.openingAttestationRequired'),
              opening_count_incomplete: t('inventoryV2.operations.openingIncomplete'),
              opening_unit_cost_required: t('inventoryV2.operations.openingCostRequired'),
              adjustment_unit_cost_required: t('inventoryV2.operations.adjustmentCostRequired'),
              variance_policy_required: t('inventoryV2.operations.variancePolicyRequired'),
              variance_account_code_required: t('inventoryV2.operations.varianceAccountRequired'),
              count_variance_allocation_mismatch: t('inventoryV2.operations.varianceAllocationMismatch'),
              stock_insufficient: t('inventoryV2.operations.insufficient'),
            }}
          />
          <InventoryCountRejectionForm
            action={rejectInventoryCountAction.bind(null, count.id)}
            locale={locale}
            idempotencyKey={`inventory-count-rejection:${count.id}:${randomUUID()}`}
            expectedCountVersion={count.version}
            labels={{
              reason: t('inventoryV2.operations.rejectionReason'),
              reject: t('inventoryV2.operations.rejectCount'),
            }}
            errors={{
              invalid_input: t('inventoryV2.operations.invalid'),
              count_approval_forbidden: t('inventoryV2.operations.forbidden'),
              count_not_approvable: t('inventoryV2.operations.invalid'),
              document_stale: t('inventoryV2.operations.stale'),
              idempotency_conflict: t('inventoryV2.operations.invalid'),
            }}
          />
        </section>
      ) : null}
    </>
  );
}
