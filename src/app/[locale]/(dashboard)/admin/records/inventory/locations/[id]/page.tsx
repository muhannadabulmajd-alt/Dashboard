import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { LOCAL_OPEX_CATEGORY_TYPES } from '@/lib/enums';
import { formatQuantity } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import { getLocationAvailability } from '@/server/inventory-v2/availability';
import {
  saveInventoryVariancePolicyAction,
  saveStockLocationAction,
} from '@/server/inventory-v2/setup-actions';
import { saveLocationExpensePolicyAction } from '@/server/inventory-v2/local-expense-actions';
import { LocationExpensePolicyForm } from '@/components/finance/LocalExpenseForms';
import { InventoryVariancePolicyForm } from '@/components/records/InventoryVariancePolicyForm';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid } from '@/components/records/parts';
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

export default async function StockLocationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'manage:inventory');
  if (!getInventoryV2Config().enabled || (user.role !== 'OWNER' && user.role !== 'ADMIN')) notFound();
  const { id } = await params;
  const t = await getTranslations('records');
  const te = await getTranslations('finance.localExpenses');
  const [location, branches] = await Promise.all([
    prisma.stockLocation.findUnique({
      where: { id },
      include: {
        branch: true,
        policies: {
          where: { isActive: true },
          include: { inventoryItem: true },
          orderBy: { inventoryItem: { nameEn: 'asc' } },
        },
        expensePolicy: true,
        variancePolicy: true,
      },
    }),
    prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    }),
  ]);
  if (!location) notFound();
  const availability = await prisma.$transaction(async (tx) => Promise.all(
    location.policies.map((policy) => getLocationAvailability(tx, policy.inventoryItemId, location.id)),
  ));
  const availabilityByItem = new Map(availability.map((row) => [row.inventoryItemId, row]));
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
    { label: t('f.item') },
    { label: t('f.category') },
    { label: t('inventoryV2.onHand'), align: 'end' },
    { label: t('inventoryV2.reserved'), align: 'end' },
    { label: t('inventoryV2.available'), align: 'end' },
    { label: t('inventoryV2.inTransit'), align: 'end' },
    { label: t('inventoryV2.quarantine'), align: 'end' },
    { label: t('inventoryV2.nextExpiry') },
  ];
  const rows = location.policies.map((policy) => {
    const row = availabilityByItem.get(policy.inventoryItemId);
    return [
      <Link key={policy.inventoryItemId} href={`/admin/records/inventory/${policy.inventoryItemId}`} className="font-semibold text-primary hover:underline">
        {locale === 'ar' ? policy.inventoryItem.nameAr : policy.inventoryItem.nameEn}
      </Link>,
      enumLabel(policy.inventoryItem.category, locale),
      formatQuantity(row?.onHand ?? 0, locale),
      formatQuantity(row?.reserved ?? 0, locale),
      formatQuantity(row?.available ?? 0, locale),
      formatQuantity(row?.inTransit ?? 0, locale),
      formatQuantity(row?.quarantine ?? 0, locale),
      row?.nextExpiry ? formatDate(row.nextExpiry, locale) : '—',
    ];
  });

  return (
    <>
      <BackLink href="/admin/records/inventory/locations" label={t('back')} />
      <PageHeader title={locale === 'ar' ? location.nameAr : location.nameEn} subtitle={location.code} />
      <DetailGrid items={[
        { label: t('f.branch'), value: locale === 'ar' ? location.branch.nameAr : location.branch.nameEn },
        { label: t('inventoryV2.locationType'), value: enumLabel(location.type, locale) },
        { label: t('inventoryV2.stockVersion'), value: location.stockVersion },
        { label: t('inventoryV2.centralFulfillment'), value: location.isCentralFulfillment ? t('inventoryV2.yes') : t('inventoryV2.no') },
      ]} />
      <div className="mt-5">
        <RecordForm
          action={saveStockLocationAction.bind(null, location.id)}
          fields={fields}
          initial={{
            branchId: location.branchId,
            code: location.code,
            nameEn: location.nameEn,
            nameAr: location.nameAr,
            type: location.type,
            isActive: location.isActive,
            isCentralFulfillment: location.isCentralFulfillment,
          }}
          locale={locale}
          submitLabel={t('save')}
          cancelHref="/admin/records/inventory/locations"
          cancelLabel={t('cancel')}
          errors={{
            invalid: t('err.invalid'),
            forbidden: t('err.forbidden'),
            branch_not_found: t('inventoryV2.branchNotFound'),
            location_not_empty: t('inventoryV2.locationNotEmpty'),
            location_branch_immutable: t('inventoryV2.locationBranchImmutable'),
            central_fulfillment_must_be_finished_warehouse: t('inventoryV2.centralTypeError'),
          }}
        />
      </div>
      <LocationExpensePolicyForm
        action={saveLocationExpensePolicyAction.bind(null, location.id)}
        locale={locale}
        expectedLocationVersion={location.stockVersion}
        categories={LOCAL_OPEX_CATEGORY_TYPES.map((value) => ({ value, label: enumLabel(value, locale) }))}
        initial={{
          isActive: location.expensePolicy?.isActive ?? false,
          allowedCategories: location.expensePolicy?.allowedCategories ?? [],
          maxImmediateAmount: location.expensePolicy?.maxImmediateAmount ?? 0,
          receiptRequiredAbove: location.expensePolicy?.receiptRequiredAbove ?? 0,
        }}
        labels={{
          policyTitle: te('policyTitle'),
          policyHint: te('policyHint'),
          policyActive: te('policyActive'),
          allowedCategories: te('allowedCategories'),
          maxImmediateAmount: te('maxImmediateAmount'),
          receiptRequiredAbove: te('receiptRequiredAbove'),
          savePolicy: te('savePolicy'),
        }}
        errors={{
          forbidden: te('errors.forbidden'),
          invalid_input: te('errors.invalid'),
          location_stale: te('errors.stale'),
          location_not_found: te('errors.locationNotFound'),
        }}
      />
      <InventoryVariancePolicyForm
        action={saveInventoryVariancePolicyAction.bind(null, location.id)}
        locale={locale}
        expectedLocationVersion={location.stockVersion}
        initial={{
          isActive: location.variancePolicy?.isActive ?? false,
          openingBalanceAccountCode: location.variancePolicy?.openingBalanceAccountCode ?? '',
          inventoryGainAccountCode: location.variancePolicy?.inventoryGainAccountCode ?? '',
          inventoryLossAccountCode: location.variancePolicy?.inventoryLossAccountCode ?? '',
        }}
        labels={{
          title: t('inventoryV2.variancePolicy.title'),
          hint: t('inventoryV2.variancePolicy.hint'),
          active: t('inventoryV2.variancePolicy.active'),
          opening: t('inventoryV2.variancePolicy.opening'),
          gain: t('inventoryV2.variancePolicy.gain'),
          loss: t('inventoryV2.variancePolicy.loss'),
          save: t('inventoryV2.variancePolicy.save'),
        }}
        errors={{
          forbidden: t('err.forbidden'),
          invalid: t('err.invalid'),
          location_stale: t('inventoryV2.variancePolicy.stale'),
          variance_account_code_required: t('inventoryV2.variancePolicy.required'),
          account_code_invalid: t('inventoryV2.variancePolicy.invalidCode'),
        }}
      />
      <div className="mt-5 space-y-2">
        <h2 className="text-sm font-bold">{t('inventoryV2.locationStock')}</h2>
        <DataTable columns={columns} rows={rows} emptyLabel={t('none')} />
      </div>
    </>
  );
}
