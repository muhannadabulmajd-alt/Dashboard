import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { InventoryCountForm } from '@/components/records/InventoryCountForms';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { dateInputValue, formatDate } from '@/lib/dates';
import { enumLabel } from '@/lib/enums';
import { Link } from '@/i18n/navigation';
import { getPageContext } from '@/server/page-context';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import { submitInventoryCountAction } from '@/server/inventory-v2/operations-actions';
import { getCountIndexData } from '@/server/inventory-v2/operations-read';

export default async function InventoryCountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'manage:inventory');
  if (!getInventoryV2Config().enabled) notFound();
  const t = await getTranslations('records');
  const data = await getCountIndexData(user);
  const locations = data.locations.map((location) => ({
    id: location.id,
    label: locale === 'ar'
      ? `${location.nameAr} · ${location.branch.nameAr}`
      : `${location.nameEn} · ${location.branch.nameEn}`,
    stockVersion: location.stockVersion,
    items: location.items.map((item) => ({
      inventoryItemId: item.id,
      label: `${locale === 'ar' ? item.nameAr : item.nameEn}${item.externalKey ? ` · ${item.externalKey}` : ''}`,
      unit: item.unit,
      expectedQuantity: item.availability.onHand,
    })),
  })).sort((left, right) => (
    left.id === user.defaultStockLocationId ? -1 : right.id === user.defaultStockLocationId ? 1 : 0
  ));
  const columns: Column[] = [
    { label: t('inventoryV2.operations.countNumber') },
    { label: t('inventoryV2.operations.countKind') },
    { label: t('inventoryV2.location') },
    { label: t('inventoryV2.operations.countedAt') },
    { label: t('inventoryV2.operations.lines'), align: 'end' },
    { label: t('inventoryV2.operations.status') },
    { label: t('inventoryV2.operations.submittedBy') },
    { label: t('inventoryV2.operations.approvedBy') },
    { label: '' },
  ];
  const rows = data.counts.map((count) => [
    count.countNumber,
    enumLabel(count.kind, locale),
    locale === 'ar' ? count.location.nameAr : count.location.nameEn,
    formatDate(count.countedAt, locale),
    count._count.lines,
    <Badge key="status" variant={count.status === 'APPROVED' ? 'success' : 'warning'}>{enumLabel(count.status, locale)}</Badge>,
    count.submittedBy.name,
    count.approvedBy?.name ?? count.rejectedBy?.name ?? '—',
    <Link key="open" href={`/admin/records/inventory/counts/${count.id}`} className="font-semibold text-primary hover:underline">{t('open')}</Link>,
  ]);

  return (
    <>
      <BackLink href="/admin/records/inventory" label={t('back')} />
      <PageHeader title={t('inventoryV2.operations.countTitle')} subtitle={t('inventoryV2.operations.countHint')} />
      <section className="mb-5">
        <h2 className="mb-2 text-base font-semibold">{t('inventoryV2.operations.newCount')}</h2>
        {locations.length ? (
          <InventoryCountForm
            action={submitInventoryCountAction}
            locale={locale}
            idempotencyKey={`inventory-count:${randomUUID()}`}
            countedAt={dateInputValue()}
            locations={locations}
            labels={{
              location: t('inventoryV2.location'),
              kind: t('inventoryV2.operations.countKind'),
              routineCount: t('inventoryV2.operations.routineCount'),
              openingCount: t('inventoryV2.operations.openingCount'),
              countedAt: t('inventoryV2.operations.countedAt'),
              reason: t('inventoryV2.operations.reason'),
              item: t('inventoryV2.operations.item'),
              expected: t('inventoryV2.operations.expected'),
              counted: t('inventoryV2.operations.counted'),
              notes: t('inventoryV2.operations.notes'),
              noItems: t('inventoryV2.operations.noItems'),
              blankHint: t('inventoryV2.operations.blankHint'),
              openingHint: t('inventoryV2.operations.openingHint'),
              openingAttestation: t('inventoryV2.operations.openingAttestation'),
              openingIncomplete: t('inventoryV2.operations.openingIncomplete'),
              submit: t('inventoryV2.operations.submitCount'),
            }}
            errors={{
              invalid_input: t('inventoryV2.operations.invalid'),
              invalid_date: t('inventoryV2.operations.invalid'),
              count_duplicate_item: t('inventoryV2.operations.invalid'),
              opening_attestation_required: t('inventoryV2.operations.openingAttestationRequired'),
              opening_count_incomplete: t('inventoryV2.operations.openingIncomplete'),
              opening_count_exists: t('inventoryV2.operations.openingExists'),
              opening_count_system_location: t('inventoryV2.operations.openingSystemLocation'),
              forbidden: t('inventoryV2.operations.forbidden'),
              location_count_forbidden: t('inventoryV2.operations.forbidden'),
              location_stale: t('inventoryV2.operations.stale'),
              inventory_location_not_configured: t('inventoryV2.operations.notConfigured'),
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
