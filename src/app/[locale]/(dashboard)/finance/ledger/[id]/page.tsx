import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney, formatQuantity } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { can } from '@/lib/rbac';
import { ledgerPaymentSnapshot, ledgerPaymentStatusLabel } from '@/lib/ledger-lines';
import { ledgerRecordClassLabel } from '@/lib/ledger-record-class';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { RecordActions } from '@/components/records/RecordActions';
import { SectionGuide } from '@/components/records/SectionGuide';
import { ReverseEntryForm } from '@/components/finance/ReverseEntryForm';
import { reverseEntryWithReason } from '@/server/finance/entries';
import { archiveFinanceEntry, permanentlyDeleteFinanceEntry } from '@/server/finance/central-records';
import { reclassifyLedgerLine, splitLedgerLine } from '@/server/finance/classification';
import { Link } from '@/i18n/navigation';
import { DataTable } from '@/components/data-table/DataTable';

export default async function EntryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'view:finance');
  const { id } = await params;
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const canManage = can(user.role, 'manage:finance');
  const ownerAdmin = user.role === 'OWNER' || user.role === 'ADMIN';

  const e = await prisma.financeEntry.findUnique({
    where: { id },
    include: {
      party: true,
      account: true,
      toAccount: true,
      settlements: {
        where: { reversedAt: null, reversalOfId: null, archivedAt: null },
        orderBy: { date: 'asc' },
        include: {
          account: { select: { name: true } },
          party: { select: { name: true } },
        },
      },
      ledgerLines: {
        include: {
          inventoryItem: { select: { nameEn: true, nameAr: true, unit: true } },
          fixedAssetCostAllocations: {
            include: { fixedAsset: true },
            orderBy: { createdAt: 'asc' },
          },
          landedCostAllocations: {
            select: { id: true, amount: true, inventoryItemId: true, costLayerId: true },
          },
        },
        orderBy: { lineNo: 'asc' },
      },
      stockMovements: {
        include: { inventoryItem: { select: { nameEn: true, nameAr: true, unit: true } } },
        orderBy: { occurredAt: 'desc' },
      },
      costLayers: {
        include: { inventoryItem: { select: { nameEn: true, nameAr: true, unit: true } } },
        orderBy: { receivedAt: 'desc' },
      },
      fixedAssets: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!e) notFound();
  const [branch, createdBy, reversedBy, archivedBy, activeAssets, inventoryItems] = await Promise.all([
    e.branchId ? prisma.branch.findUnique({ where: { id: e.branchId }, select: { nameEn: true, nameAr: true } }) : null,
    e.createdById ? prisma.user.findUnique({ where: { id: e.createdById }, select: { name: true, email: true } }) : null,
    e.reversedById ? prisma.user.findUnique({ where: { id: e.reversedById }, select: { name: true, email: true } }) : null,
    e.archivedById ? prisma.user.findUnique({ where: { id: e.archivedById }, select: { name: true, email: true } }) : null,
    ownerAdmin
      ? prisma.fixedAsset.findMany({
          where: { isActive: true, archivedAt: null },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, totalCost: true },
        })
      : [],
    ownerAdmin
      ? prisma.inventoryItem.findMany({
          where: { isActive: true },
          orderBy: [{ nameEn: 'asc' }, { nameAr: 'asc' }],
          select: { id: true, nameEn: true, nameAr: true, unit: true },
        })
      : [],
  ]);
  const branchName = branch ? (locale === 'ar' ? branch.nameAr : branch.nameEn) : '—';
  const isReversed = Boolean(e.reversedAt);
  const isReversalMarker = Boolean(e.reversalOfId);
  const isArchived = Boolean(e.archivedAt);
  const managedBySync = Boolean(e.importKey);
  const hasSettlements = e.obligation && e.settlements.length > 0;
  const canEdit = ownerAdmin || (canManage && !isArchived && !isReversed && !isReversalMarker && !managedBySync);
  const canReverse = canEdit && !hasSettlements;
  const paidAmount = e.obligation ? e.settlements.reduce((sum, payment) => sum + payment.amount, 0) : e.amount;
  const paymentSnapshot = ledgerPaymentSnapshot(e.amount, paidAmount, { reversed: isReversed || isReversalMarker });
  const linkedAssets = [
    ...new Map(
      [
        ...e.fixedAssets,
        ...e.ledgerLines.flatMap((line) =>
          line.fixedAssetCostAllocations.map((allocation) => allocation.fixedAsset),
        ),
      ].map((asset) => [asset.id, asset]),
    ).values(),
  ];

  const items: DetailField[] = [
    { label: t('f.transactionId'), value: e.id },
    { label: t('f.type'), value: enumLabel(e.type, locale) },
    ...(e.recordClass ? [{ label: locale === 'ar' ? 'التصنيف' : 'Classification', value: ledgerRecordClassLabel(e.recordClass, locale) }] : []),
    { label: t('f.amount'), value: formatMoney(e.amount, e.currency, locale) },
    { label: t('paidAmount'), value: formatMoney(paymentSnapshot.paid, e.currency, locale) },
    { label: t('remainingAmount'), value: formatMoney(paymentSnapshot.remaining, e.currency, locale) },
    { label: t('paymentStatus'), value: ledgerPaymentStatusLabel(paymentSnapshot.status, locale) },
    { label: t('f.paymentMethod'), value: e.paymentMethod ? enumLabel(e.paymentMethod, locale) : '—' },
    ...(e.origCurrency === 'USD' && e.origAmount != null
      ? [{ label: t('f.origPaid'), value: `${formatMoney(e.origAmount, 'USD', locale)} × ${e.fxRate ?? '—'}` }]
      : []),
    { label: t('f.date'), value: formatDate(e.date, locale) },
    {
      label: t('f.status'),
      value: (
        <Badge variant={isArchived ? 'warning' : isReversalMarker ? 'muted' : isReversed ? 'danger' : e.obligation ? 'warning' : 'success'}>
          {isArchived ? t('archived') : isReversalMarker ? t('reversalMarker') : isReversed ? t('reversed') : e.obligation ? t('f.due') : t('f.paid')}
        </Badge>
      ),
    },
    { label: t('f.kind'), value: e.obligationKind ? enumLabel(e.obligationKind, locale) : '—' },
    { label: t('f.dueDate'), value: e.dueDate ? formatDate(e.dueDate, locale) : '—' },
    { label: t('f.account'), value: e.account?.name ?? '—' },
    { label: t('f.toAccount'), value: e.toAccount?.name ?? '—' },
    { label: t('f.party'), value: e.party?.name ?? '—' },
    { label: t('f.category'), value: e.categoryType ? enumLabel(e.categoryType, locale) : '—' },
    { label: t('f.branch'), value: branchName },
    { label: t('f.related'), value: e.orderId ?? e.importKey ?? '—' },
    { label: t('f.createdBy'), value: createdBy ? createdBy.name || createdBy.email : '—' },
    { label: t('f.description'), value: e.description ?? '—' },
    { label: t('f.reference'), value: e.reference ?? '—' },
    {
      label: t('f.attachmentUrl'),
      value: e.attachmentUrl ? (
        <a href={e.attachmentUrl} className="font-medium text-primary hover:underline" target="_blank" rel="noreferrer">
          {t('viewAttachment')}
        </a>
      ) : '—',
    },
    { label: t('reversalOf'), value: e.reversalOfId ?? '—' },
    { label: t('reversedAt'), value: e.reversedAt ? formatDate(e.reversedAt, locale) : '—' },
    { label: t('reversedBy'), value: reversedBy ? reversedBy.name || reversedBy.email : '—' },
    { label: t('reversalReason'), value: e.reversalReason ?? '—' },
    { label: t('archivedAt'), value: e.archivedAt ? formatDate(e.archivedAt, locale) : '—' },
    { label: t('archivedBy'), value: archivedBy ? archivedBy.name || archivedBy.email : '—' },
    { label: t('archiveReason'), value: e.archiveReason ?? '—' },
  ];

  return (
    <>
      <BackLink href="/finance/ledger" label={tr('back')} />
      <PageHeader title={e.recordClass ? ledgerRecordClassLabel(e.recordClass, locale) : enumLabel(e.type, locale)} subtitle={formatMoney(e.amount, e.currency, locale)} />
      <SectionGuide
        title={t('guide.audit.title')}
        intro={t('guide.audit.intro')}
        points={t.raw('guide.audit.points')}
      />
      {canManage ? (
        <RecordActions
          editHref={canEdit ? `/finance/ledger/${e.id}/edit` : undefined}
          isActive={!isArchived}
          archiveAction={ownerAdmin ? archiveFinanceEntry.bind(null, e.id, locale, isArchived) : undefined}
          deleteAction={ownerAdmin ? permanentlyDeleteFinanceEntry.bind(null, e.id, locale) : undefined}
          labels={{
            edit: tr('edit'),
            archive: tr('archive'),
            restore: tr('restore'),
            delete: tr('delete'),
            confirm: t('confirmPermanentDelete'),
          }}
        />
      ) : null}
      <DetailGrid items={items} />
      {e.obligation || e.settlements.length ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{t('paymentHistory')}</h3>
            {canManage && paymentSnapshot.remaining > 0 && !isArchived && !isReversed ? (
              <Link href={`/finance/dues/${e.id}/settle`} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-95">
                {t('recordPayment')}
              </Link>
            ) : null}
          </div>
          <DataTable
            columns={[
              { label: t('f.date') },
              { label: t('f.amount'), align: 'end' },
              { label: t('f.account') },
              { label: t('f.paymentMethod') },
              { label: t('f.description') },
            ]}
            rows={e.settlements.map((payment) => [
              formatDate(payment.date, locale),
              formatMoney(payment.amount, payment.currency, locale),
              payment.account?.name ?? '—',
              payment.paymentMethod ? enumLabel(payment.paymentMethod, locale) : '—',
              payment.description ?? payment.reference ?? '—',
            ])}
            emptyLabel={tr('none')}
          />
        </div>
      ) : null}
      {e.ledgerLines.length ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('lineItems')}</h3>
          <DataTable
            columns={[
              { label: '#' },
              { label: t('f.item') },
              { label: t('f.category') },
              { label: t('f.quantity'), align: 'end' },
              { label: t('f.value'), align: 'end' },
              { label: t('spendTreatment') },
              { label: t('classificationStatus') },
              { label: t('f.description') },
              ...(ownerAdmin ? [{ label: t('reclassify') }] : []),
            ]}
            rows={e.ledgerLines.map((line) => {
              const values = [
                line.lineNo,
                line.inventoryItem ? (locale === 'ar' ? line.inventoryItem.nameAr : line.inventoryItem.nameEn) : line.itemName,
                line.categoryType ? enumLabel(line.categoryType, locale) : line.itemType,
                `${formatQuantity(line.quantity, locale)} ${line.unit}`,
                formatMoney(line.lineTotal, 'IQD', locale),
                enumLabel(line.spendTreatment, locale),
                <Badge
                  key={`status-${line.id}`}
                  variant={line.classificationStatus === 'CONFIRMED' ? 'success' : 'warning'}
                >
                  {line.classificationStatus === 'CONFIRMED'
                    ? t('classificationConfirmed')
                    : t('classificationNeedsReview')}
                </Badge>,
                line.classificationNote ?? line.notes ?? '—',
              ];
              if (ownerAdmin) {
                values.push(
                  <div key={`controls-${line.id}`} className="flex min-w-64 flex-col gap-2">
                    <form
                      action={reclassifyLedgerLine.bind(null, e.id, line.id)}
                      className="flex flex-col gap-1.5"
                    >
                      <select
                        name="spendTreatment"
                        defaultValue={line.spendTreatment}
                        className="min-h-9 rounded-lg border bg-background px-2 text-xs"
                      >
                        <option value="CAPEX">{t('capex')}</option>
                        <option value="INVENTORY">{t('inventoryBought')}</option>
                        <option value="OPEX">{t('opex')}</option>
                        <option value="REVIEW">{t('classificationNeedsReview')}</option>
                      </select>
                      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                        {t('assetAllocationTarget')}
                        <select
                          name="fixedAssetId"
                          defaultValue={line.fixedAssetCostAllocations[0]?.fixedAsset.id ?? ''}
                          className="min-h-9 rounded-lg border bg-background px-2 text-xs text-roast"
                        >
                          <option value="">{t('createAssetAutomatically')}</option>
                          {activeAssets.map((asset) => (
                            <option key={asset.id} value={asset.id}>
                              {asset.name} · {formatMoney(asset.totalCost, 'IQD', locale)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                        {t('inventoryAllocationTarget')}
                        <select
                          name="inventoryItemId"
                          defaultValue={
                            line.landedCostAllocations[0]?.inventoryItemId ??
                            line.inventoryItemId ??
                            ''
                          }
                          className="min-h-9 rounded-lg border bg-background px-2 text-xs text-roast"
                        >
                          <option value="">{t('keepInventoryAllocationPending')}</option>
                          {inventoryItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {locale === 'ar' ? item.nameAr : item.nameEn} · {item.unit}
                            </option>
                          ))}
                        </select>
                      </label>
                      <input
                        name="classificationNote"
                        required
                        defaultValue={line.classificationNote ?? ''}
                        placeholder={t('classificationReason')}
                        className="min-h-9 rounded-lg border bg-background px-2 text-xs"
                      />
                      <button className="min-h-9 rounded-lg bg-primary px-2 text-xs font-semibold text-primary-foreground">
                        {t('saveClassification')}
                      </button>
                    </form>
                    {line.lineTotal > 1 &&
                    !line.inventoryItemId &&
                    !line.fixedAssetCostAllocations.length &&
                    !line.landedCostAllocations.length ? (
                      <details className="rounded-lg border border-border/75 bg-linen/20 p-2">
                        <summary className="cursor-pointer text-xs font-semibold text-roast">
                          {t('splitClassification')}
                        </summary>
                        <form
                          action={splitLedgerLine.bind(null, e.id, line.id)}
                          className="mt-2 flex flex-col gap-1.5"
                        >
                          <input
                            name="splitAmount"
                            type="number"
                            min={1}
                            max={line.lineTotal - 1}
                            required
                            placeholder={t('splitAmount')}
                            className="min-h-9 rounded-lg border bg-background px-2 text-xs"
                          />
                          <select
                            name="splitTreatment"
                            defaultValue="CAPEX"
                            className="min-h-9 rounded-lg border bg-background px-2 text-xs"
                          >
                            <option value="CAPEX">{t('capex')}</option>
                            <option value="INVENTORY">{t('inventoryBought')}</option>
                            <option value="OPEX">{t('opex')}</option>
                          </select>
                          <input
                            name="splitNote"
                            required
                            placeholder={t('classificationReason')}
                            className="min-h-9 rounded-lg border bg-background px-2 text-xs"
                          />
                          <button className="min-h-9 rounded-lg border border-primary/40 bg-card px-2 text-xs font-semibold text-primary">
                            {t('splitAndSave')}
                          </button>
                        </form>
                      </details>
                    ) : null}
                  </div>,
                );
              }
              return values;
            })}
            emptyLabel={tr('none')}
          />
        </div>
      ) : null}
      {e.stockMovements.length || e.costLayers.length ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('linkedStock')}</h3>
          <DataTable
            columns={[
              { label: t('f.date') },
              { label: t('f.item') },
              { label: t('f.quantity'), align: 'end' },
              { label: t('f.reference') },
            ]}
            rows={e.stockMovements.map((movement) => [
              formatDate(movement.occurredAt, locale),
              locale === 'ar' ? movement.inventoryItem.nameAr : movement.inventoryItem.nameEn,
              `${formatQuantity(movement.quantity, locale)} ${movement.inventoryItem.unit}`,
              movement.reference ?? '—',
            ])}
            emptyLabel={tr('none')}
          />
        </div>
      ) : null}
      {linkedAssets.length ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('linkedAsset')}</h3>
          {linkedAssets.map((asset) => (
            <DetailGrid
              key={asset.id}
              items={[
                { label: t('f.name'), value: asset.name },
                { label: t('f.category'), value: asset.category },
                { label: t('f.quantity'), value: `${formatQuantity(asset.quantity, locale)} ${asset.unit}` },
                { label: t('f.value'), value: formatMoney(asset.totalCost, 'IQD', locale) },
              ]}
            />
          ))}
        </div>
      ) : null}
      {canReverse ? (
        <div className="space-y-2">
          <ReverseEntryForm
            action={reverseEntryWithReason.bind(null, e.id)}
            locale={locale}
            labels={{
              title: t('reversalFlow'),
              hint: t('reversalFlowHint'),
              reason: t('reversalReason'),
              placeholder: t('reversalReasonPlaceholder'),
              submit: t('reverse'),
              error: t('reversalReasonRequired'),
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t('correctionHint')}{' '}
            <Link href="/finance/ledger/new" className="font-medium text-primary hover:underline">
              {t('correctionEntry')}
            </Link>
          </p>
        </div>
      ) : canManage && hasSettlements ? (
        <div className="rounded-[var(--radius)] border border-warning/30 bg-warning-soft/40 p-4 text-sm text-muted-foreground">
          {t('reverseBlockedSettled')}
        </div>
      ) : null}
    </>
  );
}
