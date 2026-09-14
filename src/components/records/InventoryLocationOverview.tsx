import { randomUUID } from 'node:crypto';
import { getTranslations } from 'next-intl/server';
import { Plus, Settings2 } from 'lucide-react';
import type { CurrentUser } from '@/server/auth/session';
import type { AppLocale } from '@/lib/money';
import { formatMoney, formatNumber, formatQuantity } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { enumLabel } from '@/lib/enums';
import {
  getInventoryLocationOverview,
  type InventoryArea,
} from '@/server/inventory-v2/overview';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { BackLink } from '@/components/records/parts';
import { ReplenishmentReviewForm } from '@/components/records/ReplenishmentReviewForm';
import { RecordsSummary, type SummaryStat } from '@/components/records/Summary';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { Link } from '@/i18n/navigation';
import { reviewReplenishmentRequestAction } from '@/server/inventory-v2/operations-actions';

const AREAS: InventoryArea[] = ['overview', 'green', 'roasted', 'packaging', 'finished'];

export async function InventoryLocationOverview({
  locale,
  user,
  searchParams,
}: {
  locale: AppLocale;
  user: CurrentUser;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations('records');
  const requestedArea = typeof searchParams.area === 'string' ? searchParams.area : 'overview';
  const area = AREAS.includes(requestedArea as InventoryArea)
    ? requestedArea as InventoryArea
    : 'overview';
  const requestedLocationId = typeof searchParams.locationId === 'string'
    ? searchParams.locationId
    : undefined;
  const q = typeof searchParams.q === 'string' ? searchParams.q.trim().toLowerCase() : '';
  const overview = await getInventoryLocationOverview(user, {
    locationId: requestedLocationId,
    area,
  });
  const rows = overview.rows.filter(({ policy }) => {
    if (!q) return true;
    const item = policy.inventoryItem;
    return `${item.nameEn} ${item.nameAr} ${item.externalKey ?? ''}`.toLowerCase().includes(q);
  });
  const totals = rows.reduce(
    (result, row) => ({
      onHand: result.onHand + row.availability.onHand,
      reserved: result.reserved + row.availability.reserved,
      available: result.available + row.availability.available,
      low: result.low + (
        row.policy.reorderPoint != null &&
        row.availability.available <= Number(row.policy.reorderPoint)
          ? 1
          : 0
      ),
    }),
    { onHand: 0, reserved: 0, available: 0, low: 0 },
  );
  const stats: SummaryStat[] = [
    { label: t('k.total'), value: formatNumber(rows.length, locale) },
    { label: t('inventoryV2.onHand'), value: formatQuantity(totals.onHand, locale) },
    { label: t('inventoryV2.reserved'), value: formatQuantity(totals.reserved, locale) },
    { label: t('inventoryV2.available'), value: formatQuantity(totals.available, locale) },
    { label: t('k.reorder'), value: formatNumber(totals.low, locale), tone: totals.low ? 'danger' : 'default' },
  ];
  const columns: Column[] = [
    { label: t('f.item') },
    { label: t('f.category') },
    { label: t('f.unit') },
    { label: t('inventoryV2.onHand'), align: 'end' },
    { label: t('inventoryV2.reserved'), align: 'end' },
    { label: t('inventoryV2.available'), align: 'end' },
    { label: t('inventoryV2.inTransit'), align: 'end' },
    { label: t('inventoryV2.quarantine'), align: 'end' },
    { label: t('inventoryV2.producible'), align: 'end' },
    { label: t('inventoryV2.nextExpiry') },
    { label: '' },
  ];
  const tableRows = rows.map(({ policy, availability }) => [
    locale === 'ar' ? policy.inventoryItem.nameAr : policy.inventoryItem.nameEn,
    enumLabel(policy.inventoryItem.category, locale),
    policy.inventoryItem.unit,
    formatQuantity(availability.onHand, locale),
    formatQuantity(availability.reserved, locale),
    formatQuantity(availability.available, locale),
    formatQuantity(availability.inTransit, locale),
    formatQuantity(availability.quarantine, locale),
    formatQuantity(availability.producible, locale),
    availability.nextExpiry ? formatDate(availability.nextExpiry, locale) : '—',
    <Link key={policy.inventoryItemId} href={`/admin/records/inventory/${policy.inventoryItemId}`} className="font-semibold text-primary hover:underline">
      {t('open')}
    </Link>,
  ]);
  const ownerAdmin = user.role === 'OWNER' || user.role === 'ADMIN';
  const operationalStats: SummaryStat[] = [
    {
      label: t('inventoryV2.salesPoint.todaySales'),
      value: formatMoney(overview.operations.todaySales, 'IQD', locale),
      tone: overview.operations.todaySales ? 'success' : 'default',
    },
    {
      label: t('inventoryV2.salesPoint.todayOrders'),
      value: formatNumber(overview.operations.todayOrders, locale),
    },
    {
      label: t('inventoryV2.salesPoint.localCash'),
      value: overview.operations.localCashAccounts.length
        ? formatMoney(overview.operations.localCash, 'IQD', locale)
        : '—',
    },
    {
      label: t('inventoryV2.salesPoint.pendingCounts'),
      value: formatNumber(overview.operations.pendingCountTotal, locale),
      tone: overview.operations.pendingCountTotal ? 'warning' : 'default',
    },
    {
      label: t('inventoryV2.salesPoint.replenishments'),
      value: formatNumber(overview.operations.replenishmentTotal, locale),
      tone: overview.operations.replenishmentTotal ? 'warning' : 'default',
    },
    {
      label: t('inventoryV2.salesPoint.incomingTransfers'),
      value: formatNumber(overview.operations.incomingTransferTotal, locale),
    },
  ];
  const replenishmentColumns: Column[] = [
    { label: t('inventoryV2.salesPoint.request') },
    { label: t('f.item') },
    { label: t('inventoryV2.operations.quantity'), align: 'end' },
    { label: t('inventoryV2.operations.source') },
    { label: t('entities.orders') },
    { label: t('inventoryV2.operations.status') },
    ...(ownerAdmin ? [{ label: t('inventoryV2.salesPoint.centralReview') }] : []),
  ];
  const replenishmentErrors = {
    forbidden: t('inventoryV2.operations.forbidden'),
    replenishment_review_forbidden: t('inventoryV2.operations.forbidden'),
    replenishment_not_found: t('inventoryV2.salesPoint.requestNotFound'),
    replenishment_transition_invalid: t('inventoryV2.salesPoint.transitionInvalid'),
    document_stale: t('inventoryV2.operations.stale'),
    idempotency_conflict: t('inventoryV2.salesPoint.idempotencyConflict'),
    invalid_input: t('inventoryV2.operations.invalid'),
  };
  const replenishmentRows = overview.operations.replenishmentRequests.map((request) => [
    request.requestNumber,
    locale === 'ar' ? request.inventoryItem.nameAr : request.inventoryItem.nameEn,
    `${formatQuantity(Number(request.quantity), locale)} ${request.inventoryItem.unit}`,
    request.sourceLocation
      ? (locale === 'ar' ? request.sourceLocation.nameAr : request.sourceLocation.nameEn)
      : '—',
    request.order ? (
      <Link key="order" href={`/admin/records/orders/${request.order.id}`} className="font-semibold text-primary hover:underline">
        {request.order.orderNumber}
      </Link>
    ) : '—',
    <Badge key="status" variant={request.status === 'OPEN' ? 'warning' : 'default'}>
      {enumLabel(request.status, locale)}
    </Badge>,
    ...(ownerAdmin ? [
      <ReplenishmentReviewForm
        key="review"
        action={reviewReplenishmentRequestAction.bind(null, request.id)}
        status={request.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'OPEN'}
        version={request.version}
        idempotencyKey={`replenishment-review:${randomUUID()}`}
        labels={{
          reason: t('inventoryV2.salesPoint.reviewReason'),
          start: t('inventoryV2.salesPoint.startReplenishment'),
          cancel: t('inventoryV2.salesPoint.cancelReplenishment'),
          saved: t('inventoryV2.salesPoint.reviewSaved'),
        }}
        errors={replenishmentErrors}
      />,
    ] : []),
  ]);
  const incomingColumns: Column[] = [
    { label: t('inventoryV2.operations.document') },
    { label: t('inventoryV2.operations.source') },
    { label: t('inventoryV2.operations.date') },
    { label: t('inventoryV2.operations.expectedDate') },
    { label: t('inventoryV2.salesPoint.outstandingItems'), align: 'end' },
    { label: t('inventoryV2.operations.outstanding'), align: 'end' },
    { label: '' },
  ];
  const incomingRows = overview.operations.incomingTransfers.map((document) => [
    document.documentNumber,
    document.sourceLocation
      ? (locale === 'ar' ? document.sourceLocation.nameAr : document.sourceLocation.nameEn)
      : '—',
    formatDate(document.occurredAt, locale),
    document.expectedAt ? formatDate(document.expectedAt, locale) : '—',
    formatNumber(document.outstandingItems, locale),
    formatQuantity(document.outstandingQuantity, locale),
    <Link key="open" href={`/admin/records/inventory/transfers/${document.id}`} className="font-semibold text-primary hover:underline">
      {t('open')}
    </Link>,
  ]);
  const countColumns: Column[] = [
    { label: t('inventoryV2.operations.countNumber') },
    { label: t('inventoryV2.operations.countKind') },
    { label: t('inventoryV2.operations.countedAt') },
    { label: t('inventoryV2.operations.submittedBy') },
    { label: '' },
  ];
  const countRows = overview.operations.pendingCounts.map((count) => [
    count.countNumber,
    count.kind === 'OPENING'
      ? t('inventoryV2.operations.openingCount')
      : t('inventoryV2.operations.routineCount'),
    formatDate(count.countedAt, locale),
    count.submittedBy.name,
    <Link key="open" href={`/admin/records/inventory/counts/${count.id}`} className="font-semibold text-primary hover:underline">
      {t('open')}
    </Link>,
  ]);

  return (
    <>
      <BackLink href="/admin/records" label={t('back')} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title={t('entities.inventory')}
          subtitle={overview.location
            ? (locale === 'ar' ? overview.location.nameAr : overview.location.nameEn)
            : t('inventoryV2.noLocations')}
        />
        {ownerAdmin ? (
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/records/inventory/locations" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted">
              <Settings2 className="size-4" />
              {t('inventoryV2.locationsTitle')}
            </Link>
            <Link href="/admin/records/inventory/new" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
              <Plus className="size-4" />
              {t('add')}
            </Link>
          </div>
        ) : null}
      </div>

      <nav className="mb-4 flex gap-2 overflow-x-auto border-b pb-2" aria-label={t('inventoryV2.inventoryAreas')}>
        {AREAS.map((value) => (
          <Link
            key={value}
            href={`/admin/records/inventory?area=${value}${overview.location ? `&locationId=${overview.location.id}` : ''}`}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${area === value ? 'bg-primary text-primary-foreground' : 'border bg-card hover:bg-muted'}`}
          >
            {t(`inventoryV2.areas.${value}`)}
          </Link>
        ))}
      </nav>

      <form method="get" className="mb-4 grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <input type="hidden" name="area" value={area} />
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {t('inventoryV2.location')}
          <select name="locationId" defaultValue={overview.location?.id ?? ''} className="min-h-10 rounded-lg border bg-background px-3 text-sm text-foreground">
            <option value="">—</option>
            {overview.locations.map((location) => (
              <option key={location.id} value={location.id}>
                {locale === 'ar'
                  ? `${location.nameAr} · ${location.branch.nameAr}`
                  : `${location.nameEn} · ${location.branch.nameEn}`}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {t('tools.search')}
          <input name="q" defaultValue={q} className="min-h-10 rounded-lg border bg-background px-3 text-sm text-foreground" />
        </label>
        <button type="submit" className="min-h-10 self-end rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
          {t('inventoryV2.applyView')}
        </button>
      </form>

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {[
          ['transfers', t('inventoryV2.transfers')],
          ['counts', t('inventoryV2.counts')],
          ['packing', t('inventoryV2.operations.packingTitle')],
          ['returns', t('inventoryV2.operations.returnsTitle')],
          ['lots', t('inventoryV2.lots')],
          ['movements', t('inventoryV2.movementHistory')],
        ].map(([path, label]) => (
          <Link key={path} href={`/admin/records/inventory/${path}`} className="rounded-lg border bg-card px-3 py-2 font-semibold hover:bg-muted">
            {label}
          </Link>
        ))}
      </div>
      {overview.location ? (
        <section className="mb-6 space-y-3" aria-labelledby="sales-point-operations-heading">
          <div>
            <h2 id="sales-point-operations-heading" className="text-lg font-bold">
              {t('inventoryV2.salesPoint.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('inventoryV2.salesPoint.hint')}</p>
          </div>
          <RecordsSummary stats={operationalStats} />
          {!overview.operations.localCashAccounts.length && overview.location.type === 'SALES_POINT' ? (
            <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
              {t('inventoryV2.salesPoint.cashAccountMissing')}
            </p>
          ) : null}
          {overview.operations.incomingTransfers.length ? (
            <div className="space-y-2">
              <h3 className="font-semibold">{t('inventoryV2.salesPoint.incomingTransfers')}</h3>
              <DataTable columns={incomingColumns} rows={incomingRows} emptyLabel={t('none')} />
            </div>
          ) : null}
          {overview.operations.replenishmentRequests.length ? (
            <div className="space-y-2">
              <h3 className="font-semibold">{t('inventoryV2.salesPoint.replenishments')}</h3>
              <DataTable columns={replenishmentColumns} rows={replenishmentRows} emptyLabel={t('none')} />
            </div>
          ) : null}
          {overview.operations.pendingCounts.length ? (
            <div className="space-y-2">
              <h3 className="font-semibold">{t('inventoryV2.salesPoint.pendingCounts')}</h3>
              <DataTable columns={countColumns} rows={countRows} emptyLabel={t('none')} />
            </div>
          ) : null}
        </section>
      ) : null}
      <RecordsSummary stats={stats} />
      <DataTable columns={columns} rows={tableRows} emptyLabel={t('none')} />
    </>
  );
}
