import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney, formatNumber, formatPercent, formatQuantity } from '@/lib/money';
import { decimalNumber } from '@/lib/decimal';
import { formatDate, dateInputValue } from '@/lib/dates';
import { gramsPerUnit, roastYieldFor } from '@/lib/roast';
import { getListOptions } from '@/server/lists/resolver';
import { roastedCostPerKg } from '@/lib/metrics/roasting';
import { fifoStatus } from '@/lib/metrics/inventory';
import { getRoastConfig } from '@/server/settings';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { RecordActions } from '@/components/records/RecordActions';
import { RecordForm, type FieldDef } from '@/components/records/form';
import { archiveInventory, deleteInventory, receiveStock, setInventoryQuantity } from '@/server/records/inventory';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import {
  financeAccountWhereForScope,
  inventoryItemWhereForScope,
  resolveLocationObjectScope,
} from '@/server/inventory-v2/object-scope';
import { getLocationAvailability } from '@/server/inventory-v2/availability';
import { inventoryReadTransaction } from '@/server/inventory-v2/read-transaction';
import { saveInventoryLocationPolicyAction } from '@/server/inventory-v2/setup-actions';
import { receivePurchasedStockAction } from '@/server/inventory-v2/operations-actions';
import { PurchaseReceiptForm } from '@/components/records/PurchaseReceiptForm';
import { InventoryLocationPolicyForm } from '@/components/records/InventoryLocationPolicyForm';

export default async function InventoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'manage:inventory');
  const { id } = await params;
  const t = await getTranslations('records');
  const inventoryV2Enabled = getInventoryV2Config().enabled;
  const ownerAdmin = user.role === 'OWNER' || user.role === 'ADMIN';
  const objectScope = await resolveLocationObjectScope(user);
  const [item, accounts, parties, policyLocations] = await Promise.all([
    prisma.inventoryItem.findFirst({
      where: { id, ...inventoryItemWhereForScope(objectScope) },
      include: {
        movements: {
          where: inventoryV2Enabled && !objectScope.unrestricted
            ? { locationId: { in: objectScope.locationIds } }
            : {},
          include: { location: { select: { nameEn: true, nameAr: true } } },
          orderBy: { occurredAt: 'desc' },
        },
        costLayers: {
          where: ownerAdmin ? {} : { id: '__restricted__' },
          orderBy: { receivedAt: 'asc' },
        },
        locationPolicies: {
          where: inventoryV2Enabled && !objectScope.unrestricted
            ? { locationId: { in: objectScope.locationIds }, isActive: true }
            : {},
          include: { location: { include: { branch: true } } },
          orderBy: { location: { nameEn: 'asc' } },
        },
      },
    }),
    prisma.financeAccount.findMany({
      where: {
        isActive: true,
        currency: 'IQD',
        type: { not: 'PAYMENT_GATEWAY' },
        ...financeAccountWhereForScope(objectScope),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, currency: true },
    }),
    prisma.party.findMany({
      where: { isActive: true, type: { in: ['SUPPLIER', 'OTHER'] } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true },
    }),
    inventoryV2Enabled && ownerAdmin
      ? prisma.stockLocation.findMany({
          where: { isActive: true },
          include: { branch: true },
          orderBy: [{ branch: { nameEn: 'asc' } }, { nameEn: 'asc' }],
        })
      : Promise.resolve([]),
  ]);
  if (!item) notFound();
  const locationAvailability = inventoryV2Enabled
    ? await inventoryReadTransaction(async (tx) => Promise.all(
        item.locationPolicies
          .filter((policy) => policy.isActive)
          .map((policy) => getLocationAvailability(tx, item.id, policy.locationId)),
      ))
    : [];
  const availabilityByLocation = new Map(locationAvailability.map((row) => [row.locationId, row]));

  const name = locale === 'ar' ? item.nameAr : item.nameEn;
  const current = item.movements.reduce((s, m) => s + decimalNumber(m.quantity), 0);

  // FIFO cost layers (§8): apply consumption since the first layer (oldest-first)
  // to derive each layer's remaining, the active cost, and the on-hand value.
  const since = item.costLayers[0]?.receivedAt;
  const consumed = since
    ? item.movements.reduce((s, m) => {
      const quantity = decimalNumber(m.quantity);
      return quantity < 0 && m.occurredAt >= since ? s - quantity : s;
    }, 0)
    : 0;
  const fifo = item.costLayers.length
    ? fifoStatus(
      item.costLayers.map((layer) => ({
        ...layer,
        qtyReceived: decimalNumber(layer.qtyReceived),
        unitCost: decimalNumber(layer.unitCost),
      })),
      consumed,
    )
    : null;

  // Green→roasted cost estimate (§5): for green coffee, project roasted cost
  // per roast level (managed list — added levels use the MEDIUM yield) from
  // this bean's cost-per-kg and the configured yields.
  let roast: { lvl: string; y: number; perKg: number; per250: number }[] | null = null;
  if (item.category === 'GREEN_COFFEE' && item.unitCost != null) {
    const [cfg, levels] = await Promise.all([getRoastConfig(), getListOptions('roastLevel', locale)]);
    const greenPerKg = decimalNumber(item.unitCost) * (1000 / gramsPerUnit(item.unit));
    roast = levels.map(({ value: lvl }) => {
      const y = roastYieldFor(cfg.yields, lvl);
      const perKg = roastedCostPerKg(greenPerKg, y, cfg.roastingCostPerKg);
      return { lvl, y, perKg, per250: Math.round(perKg * 0.25) };
    });
  }

  const items: DetailField[] = [
    { label: t('f.item'), value: `${item.nameEn} / ${item.nameAr}` },
    { label: t('f.category'), value: enumLabel(item.category, locale) },
    { label: t('f.unit'), value: item.unit },
    { label: t('f.currentStock'), value: formatQuantity(current, locale) },
    {
      label: t('f.reorderPoint'),
      value: item.reorderPoint != null ? formatQuantity(item.reorderPoint, locale) : '—',
    },
    {
      label: t('f.avgDailyUsage'),
      value: item.avgDailyUsage != null ? formatNumber(item.avgDailyUsage, locale) : '—',
    },
    ...(ownerAdmin ? [{
      label: t('f.unitCost'),
      value: item.unitCost != null ? formatMoney(item.unitCost, 'IQD', locale) : '—',
    }] : []),
  ];

  const mCols: Column[] = [
    { label: t('f.occurredAt') },
    ...(inventoryV2Enabled ? [{ label: t('inventoryV2.location') }] : []),
    { label: t('f.reason') },
    { label: t('f.quantity'), align: 'end' },
  ];

  const mRows = item.movements.map((m) => [
    formatDate(m.occurredAt, locale),
    ...(inventoryV2Enabled ? [m.location ? (locale === 'ar' ? m.location.nameAr : m.location.nameEn) : '—'] : []),
    enumLabel(m.reason, locale),
    formatQuantity(m.quantity, locale),
  ]);

  const receiveFields: FieldDef[] = [
    { name: 'qtyReceived', label: t('f.qtyReceived'), type: 'number', required: true, placeholder: '0.000', step: '0.001' },
    { name: 'unitCost', label: t('f.unitCost'), type: 'number', required: true, placeholder: '0.000', step: '0.001' },
    { name: 'receivedAt', label: t('f.receivedAt'), type: 'date', required: true },
    { name: 'expiryDate', label: t('f.expiryDate'), type: 'date' },
    { name: 'reference', label: t('f.reference'), type: 'text' },
    {
      name: 'paymentMode',
      label: t('f.paymentMode'),
      type: 'select',
      required: true,
      options: [
        { value: 'CREDIT', label: t('f.purchaseCredit') },
        { value: 'PAID', label: t('f.purchasePaid') },
      ],
    },
    {
      name: 'accountId',
      label: t('f.paymentAccount'),
      type: 'select',
      options: accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })),
      showWhen: { field: 'paymentMode', in: ['PAID'] },
    },
    {
      name: 'partyId',
      label: t('f.supplier'),
      type: 'select',
      options: parties.map((p) => ({ value: p.id, label: p.name })),
    },
    {
      name: 'dueDate',
      label: t('f.dueDate'),
      type: 'date',
      showWhen: { field: 'paymentMode', in: ['CREDIT'] },
    },
  ];
  const receiveErrors = { invalid: t('err.invalid'), forbidden: t('err.forbidden') };
  const adjustmentFields: FieldDef[] = [
    { name: 'targetQuantity', label: t('f.targetQuantity'), type: 'number', required: true, step: '0.001', hint: t('h.targetQuantity') },
    { name: 'occurredAt', label: t('f.adjustmentDate'), type: 'date', required: true },
    { name: 'adjustmentReason', label: t('f.adjustmentReason'), type: 'text', required: true, hint: t('h.adjustmentReason') },
  ];
  return (
    <>
      <BackLink href="/admin/records/inventory" label={t('back')} />
      <PageHeader title={name} subtitle={enumLabel(item.category, locale)} />
      <RecordActions
        editHref={!inventoryV2Enabled || ownerAdmin ? `/admin/records/inventory/${item.id}/edit` : undefined}
        isActive={item.isActive}
        archiveAction={!inventoryV2Enabled || ownerAdmin ? archiveInventory.bind(null, item.id, locale, !item.isActive) : undefined}
        deleteAction={inventoryV2Enabled ? undefined : deleteInventory.bind(null, item.id, locale)}
        labels={{
          edit: t('edit'),
          archive: t('archive'),
          restore: t('restore'),
          delete: t('delete'),
          confirm: t('confirmDelete'),
        }}
      />
      <DetailGrid items={items} />

      {inventoryV2Enabled ? (
        <div className="mt-5 space-y-2">
          <h3 className="text-sm font-semibold">{t('inventoryV2.locationStock')}</h3>
          <DataTable
            columns={[
              { label: t('inventoryV2.location') },
              { label: t('inventoryV2.onHand'), align: 'end' },
              { label: t('inventoryV2.reserved'), align: 'end' },
              { label: t('inventoryV2.available'), align: 'end' },
              { label: t('inventoryV2.inTransit'), align: 'end' },
              { label: t('inventoryV2.quarantine'), align: 'end' },
              { label: t('inventoryV2.producible'), align: 'end' },
              { label: t('inventoryV2.nextExpiry') },
            ]}
            rows={item.locationPolicies.filter((policy) => policy.isActive).map((policy) => {
              const availability = availabilityByLocation.get(policy.locationId);
              return [
                locale === 'ar' ? policy.location.nameAr : policy.location.nameEn,
                formatQuantity(availability?.onHand ?? 0, locale),
                formatQuantity(availability?.reserved ?? 0, locale),
                formatQuantity(availability?.available ?? 0, locale),
                formatQuantity(availability?.inTransit ?? 0, locale),
                formatQuantity(availability?.quarantine ?? 0, locale),
                formatQuantity(availability?.producible ?? 0, locale),
                availability?.nextExpiry ? formatDate(availability.nextExpiry, locale) : '—',
              ];
            })}
            emptyLabel={t('none')}
          />
        </div>
      ) : null}

      {inventoryV2Enabled && ownerAdmin ? (
        <div className="mt-6 space-y-2">
          <h3 className="text-sm font-semibold">{t('inventoryV2.configureItemLocation')}</h3>
          <p className="text-xs text-muted-foreground">{t('inventoryV2.configureItemLocationHint')}</p>
          <InventoryLocationPolicyForm
            action={saveInventoryLocationPolicyAction.bind(null, item.id)}
            locale={locale}
            defaultCanSell={item.category === 'FINISHED_GOOD' || item.category === 'ACCESSORY'}
            locations={policyLocations.map((location) => {
              const policy = item.locationPolicies.find((row) => row.locationId === location.id);
              return {
                id: location.id,
                label: locale === 'ar'
                  ? `${location.nameAr} · ${location.branch.nameAr}`
                  : `${location.nameEn} · ${location.branch.nameEn}`,
                stockVersion: location.stockVersion,
                policy: policy ? {
                  reorderPoint: policy.reorderPoint?.toString() ?? '',
                  targetLevel: policy.targetLevel?.toString() ?? '',
                  canSell: policy.canSell,
                  canProduce: policy.canProduce,
                  isActive: policy.isActive,
                } : null,
              };
            })}
            labels={{
              location: t('inventoryV2.location'),
              reorderPoint: t('f.reorderPoint'),
              targetLevel: t('inventoryV2.targetLevel'),
              canSell: t('inventoryV2.canSell'),
              canProduce: t('inventoryV2.canProduce'),
              isActive: t('inventoryV2.activePolicy'),
              save: t('save'),
            }}
            errors={{
              invalid: t('err.invalid'),
              invalid_input: t('err.invalid'),
              forbidden: t('err.forbidden'),
              inventory_item_not_found: t('err.notfound'),
              location_not_found: t('inventoryV2.locationNotFound'),
              location_stale: t('inventoryV2.operations.stale'),
              only_finished_goods_can_be_sold: t('inventoryV2.sellPolicyError'),
            }}
          />
        </div>
      ) : null}

      {ownerAdmin && !inventoryV2Enabled ? (
        <div className="mt-6 space-y-2">
          <h3 className="text-sm font-semibold">{t('setStockQuantity')}</h3>
          <p className="text-xs text-muted-foreground">{t('setStockQuantityHint')}</p>
          <RecordForm
            action={setInventoryQuantity.bind(null, item.id)}
            fields={adjustmentFields}
            initial={{ targetQuantity: current.toFixed(3), occurredAt: dateInputValue() }}
            locale={locale}
            submitLabel={t('setStockQuantitySubmit')}
            cancelHref={`/admin/records/inventory/${item.id}`}
            cancelLabel={t('cancel')}
            errors={receiveErrors}
          />
        </div>
      ) : null}

      {roast && ownerAdmin ? (
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold">{t('roastedCost')}</h3>
          <p className="text-xs text-muted-foreground">{t('roastedCostHint')}</p>
          <DataTable
            columns={[
              { label: t('f.roastLevel') },
              { label: t('f.yield'), align: 'end' },
              { label: t('perKg'), align: 'end' },
              { label: t('per250'), align: 'end' },
            ]}
            rows={roast.map((r) => [
              enumLabel(r.lvl, locale),
              formatPercent(r.y, locale, 0),
              formatMoney(r.perKg, 'IQD', locale),
              formatMoney(r.per250, 'IQD', locale),
            ])}
            emptyLabel="—"
          />
        </div>
      ) : null}

      {ownerAdmin ? <div className="mt-6 space-y-2">
        <h3 className="text-sm font-semibold">{t('costLayers')}</h3>
        <p className="text-xs text-muted-foreground">{t('costLayersHint')}</p>
        {fifo ? (
          <>
            <div className="flex flex-wrap gap-4 text-sm">
              <span>
                {t('activeCost')}:{' '}
                <strong>{fifo.activeCost != null ? formatMoney(fifo.activeCost, 'IQD', locale) : '—'}</strong>
              </span>
              <span>
                {t('onHandValue')}: <strong>{formatMoney(fifo.value, 'IQD', locale)}</strong>
              </span>
            </div>
            <DataTable
              columns={[
                { label: t('f.receivedAt') },
                { label: t('f.qtyReceived'), align: 'end' },
                { label: t('f.unitCost'), align: 'end' },
                { label: t('f.remaining'), align: 'end' },
                { label: t('f.value'), align: 'end' },
              ]}
              rows={fifo.layers.map((l) => [
                formatDate(l.receivedAt, locale),
                formatQuantity(l.qtyReceived, locale),
                formatMoney(l.unitCost, 'IQD', locale),
                formatQuantity(l.remaining, locale),
                formatMoney(l.remaining * l.unitCost, 'IQD', locale),
              ])}
              emptyLabel={t('none')}
            />
          </>
        ) : null}
      </div> : null}

      {!inventoryV2Enabled ? <div className="mt-4 space-y-2">
        <h3 className="text-sm font-semibold">{t('receiveStock')}</h3>
        <p className="text-xs text-muted-foreground">{t('receiveStockHint')}</p>
        <RecordForm
          action={receiveStock.bind(null, item.id)}
          fields={receiveFields}
          initial={{ receivedAt: dateInputValue(), paymentMode: 'CREDIT', dueDate: dateInputValue() }}
          locale={locale}
          submitLabel={t('receiveSubmit')}
          cancelHref={`/admin/records/inventory/${item.id}`}
          cancelLabel={t('cancel')}
          errors={receiveErrors}
        />
      </div> : null}

      {inventoryV2Enabled && ownerAdmin ? (
        <div className="mt-6 space-y-2">
          <h3 className="text-sm font-semibold">{t('inventoryV2.operations.purchaseReceiptTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('inventoryV2.operations.purchaseReceiptHint')}</p>
          <PurchaseReceiptForm
            action={receivePurchasedStockAction.bind(null, item.id)}
            locale={locale}
            idempotencyKey={`purchase-receipt:${randomUUID()}`}
            receivedAt={dateInputValue()}
            locations={item.locationPolicies
              .filter((policy) => policy.isActive && policy.location.isActive && !policy.location.isSystem)
              .map((policy) => ({
                id: policy.location.id,
                label: locale === 'ar'
                  ? `${policy.location.nameAr} · ${policy.location.branch.nameAr}`
                  : `${policy.location.nameEn} · ${policy.location.branch.nameEn}`,
                stockVersion: policy.location.stockVersion,
              }))}
            accounts={accounts.map((account) => ({ id: account.id, label: `${account.name} (${account.currency})` }))}
            suppliers={parties.map((party) => ({ id: party.id, label: party.name }))}
            labels={{
              location: t('inventoryV2.location'),
              quantity: t('f.qtyReceived'),
              unitCost: t('f.unitCost'),
              receivedAt: t('f.receivedAt'),
              bestBefore: t('inventoryV2.operations.bestBefore'),
              supplier: t('f.supplier'),
              supplierLot: t('inventoryV2.operations.supplierLot'),
              paymentMode: t('f.paymentMode'),
              credit: t('f.purchaseCredit'),
              paid: t('f.purchasePaid'),
              account: t('f.paymentAccount'),
              dueDate: t('f.dueDate'),
              reference: t('f.reference'),
              notes: t('inventoryV2.operations.notes'),
              submit: t('inventoryV2.operations.receivePurchase'),
            }}
            errors={{
              invalid_input: t('inventoryV2.operations.invalid'),
              invalid_date: t('inventoryV2.operations.invalid'),
              forbidden: t('inventoryV2.operations.forbidden'),
              purchase_receipt_forbidden: t('inventoryV2.operations.forbidden'),
              location_receive_forbidden: t('inventoryV2.operations.forbidden'),
              location_stale: t('inventoryV2.operations.stale'),
              inventory_location_not_configured: t('inventoryV2.operations.notConfigured'),
              payment_account_required: t('inventoryV2.operations.accountRequired'),
            }}
          />
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        <h3 className="text-sm font-semibold">{t('f.movements')}</h3>
        <DataTable columns={mCols} rows={mRows} emptyLabel={t('none')} />
      </div>
    </>
  );
}
