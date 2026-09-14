import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import {
  bootstrapFinishedGoodsAction,
  saveStockLocationAction,
} from '@/server/inventory-v2/setup-actions';
import { getFinishedGoodsBootstrapReadiness } from '@/server/inventory-v2/finished-goods-bootstrap';
import { InventoryBootstrapPanel } from '@/components/records/InventoryBootstrapPanel';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink } from '@/components/records/parts';
import { RecordForm, type FieldDef } from '@/components/records/form';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { Link } from '@/i18n/navigation';

const LOCATION_TYPES = [
  'RAW_WAREHOUSE',
  'ROASTERY',
  'PACKING',
  'FINISHED_WAREHOUSE',
  'SALES_POINT',
  'IN_TRANSIT',
  'QUARANTINE',
  'GENERAL',
] as const;

export default async function StockLocationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'manage:inventory');
  if (!getInventoryV2Config().enabled || (user.role !== 'OWNER' && user.role !== 'ADMIN')) notFound();
  const t = await getTranslations('records');
  const [branches, locations, bootstrapReadiness] = await Promise.all([
    prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    }),
    prisma.stockLocation.findMany({
      include: {
        branch: { select: { nameEn: true, nameAr: true } },
        _count: { select: { policies: true, userAccesses: true, movements: true } },
      },
      orderBy: [{ branch: { nameEn: 'asc' } }, { nameEn: 'asc' }],
    }),
    getFinishedGoodsBootstrapReadiness(),
  ]);
  const fields: FieldDef[] = [
    {
      name: 'branchId',
      label: t('f.branch'),
      type: 'select',
      required: true,
      options: branches.map((branch) => ({
        value: branch.id,
        label: `${branch.code} · ${locale === 'ar' ? branch.nameAr : branch.nameEn}`,
      })),
    },
    { name: 'code', label: t('inventoryV2.code'), type: 'text', required: true },
    { name: 'nameEn', label: t('f.nameEn'), type: 'text', required: true },
    { name: 'nameAr', label: t('f.nameAr'), type: 'text', required: true },
    {
      name: 'type',
      label: t('inventoryV2.locationType'),
      type: 'select',
      required: true,
      options: LOCATION_TYPES.map((type) => ({ value: type, label: enumLabel(type, locale) })),
    },
    { name: 'isActive', label: t('inventoryV2.activeLocation'), type: 'checkbox' },
    {
      name: 'isCentralFulfillment',
      label: t('inventoryV2.centralFulfillment'),
      type: 'checkbox',
      hint: t('inventoryV2.centralFulfillmentHint'),
    },
  ];
  const columns: Column[] = [
    { label: t('inventoryV2.location') },
    { label: t('f.branch') },
    { label: t('inventoryV2.locationType') },
    { label: t('inventoryV2.policies'), align: 'end' },
    { label: t('inventoryV2.users'), align: 'end' },
    { label: '' },
  ];
  const rows = locations.map((location) => [
    `${location.code} · ${locale === 'ar' ? location.nameAr : location.nameEn}${location.isCentralFulfillment ? ` · ${t('inventoryV2.central')}` : ''}`,
    locale === 'ar' ? location.branch.nameAr : location.branch.nameEn,
    enumLabel(location.type, locale),
    location._count.policies,
    location._count.userAccesses,
    <Link key={location.id} href={`/admin/records/inventory/locations/${location.id}`} className="font-semibold text-primary hover:underline">
      {t('open')}
    </Link>,
  ]);

  return (
    <>
      <BackLink href="/admin/records/inventory" label={t('back')} />
      <PageHeader title={t('inventoryV2.locationsTitle')} subtitle={t('inventoryV2.locationsHint')} />
      <InventoryBootstrapPanel
        action={bootstrapFinishedGoodsAction}
        locale={locale}
        idempotencyKey={`finished-goods-bootstrap:${randomUUID()}`}
        readiness={bootstrapReadiness}
        labels={{
          title: t('inventoryV2.bootstrap.title'),
          hint: t('inventoryV2.bootstrap.hint'),
          central: t('inventoryV2.bootstrap.central'),
          notConfigured: t('inventoryV2.bootstrap.notConfigured'),
          missingDefinitions: t('inventoryV2.bootstrap.missingDefinitions'),
          missingPolicies: t('inventoryV2.bootstrap.missingPolicies'),
          conflicts: t('inventoryV2.bootstrap.conflicts'),
          centralRequired: t('inventoryV2.bootstrap.centralRequired'),
          run: t('inventoryV2.bootstrap.run'),
          ready: t('inventoryV2.bootstrap.ready'),
          done: t('inventoryV2.bootstrap.done'),
        }}
        errors={{
          forbidden: t('err.forbidden'),
          invalid_input: t('err.invalid'),
          central_fulfillment_location_required: t('inventoryV2.bootstrap.centralRequired'),
          finished_goods_definition_conflict: t('inventoryV2.bootstrap.conflictError'),
          finished_goods_external_key_conflict: t('inventoryV2.bootstrap.keyConflict'),
          location_stale: t('inventoryV2.bootstrap.stale'),
          idempotency_conflict: t('inventoryV2.bootstrap.idempotencyConflict'),
        }}
      />
      <RecordForm
        action={saveStockLocationAction.bind(null, null)}
        fields={fields}
        initial={{ isActive: true, isCentralFulfillment: false }}
        locale={locale}
        submitLabel={t('inventoryV2.addLocation')}
        cancelHref="/admin/records/inventory"
        cancelLabel={t('cancel')}
        errors={{
          invalid: t('err.invalid'),
          forbidden: t('err.forbidden'),
          branch_not_found: t('inventoryV2.branchNotFound'),
          central_fulfillment_must_be_finished_warehouse: t('inventoryV2.centralTypeError'),
        }}
      />
      <div className="mt-5">
        <DataTable columns={columns} rows={rows} emptyLabel={t('none')} />
      </div>
    </>
  );
}
