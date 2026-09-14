import { randomUUID } from 'node:crypto';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { RoastProductionForm } from '@/components/records/RoastProductionForm';
import { BackLink } from '@/components/records/parts';
import { createBatch } from '@/server/records/batches';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import { roastGreenCoffeeAction } from '@/server/inventory-v2/operations-actions';
import { getRoastFormData } from '@/server/inventory-v2/operations-read';
import { dateInputValue } from '@/lib/dates';
import { enumLabel, ROAST_LEVELS } from '@/lib/enums';
import { batchFields } from '../_fields';

export default async function NewBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'manage:batches');
  const t = await getTranslations('records');
  const inventoryV2Enabled = getInventoryV2Config().enabled;
  const roastLocations = inventoryV2Enabled ? await getRoastFormData(user) : [];
  const tk = (k: string) => t(k);
  const errors = { invalid: t('err.invalid'), exists: t('err.exists'), forbidden: t('err.forbidden') };

  return (
    <>
      <BackLink href="/admin/records/batches" label={t('back')} />
      <PageHeader title={t('newTitle', { entity: t('entities.batches') })} />
      {inventoryV2Enabled ? (
        roastLocations.length ? (
          <RoastProductionForm
            action={roastGreenCoffeeAction}
            locale={locale}
            idempotencyKey={`roast-production:${randomUUID()}`}
            roastDate={dateInputValue()}
            locations={roastLocations.map((location) => ({
              id: location.id,
              label: locale === 'ar'
                ? `${location.nameAr} · ${location.branch.nameAr}`
                : `${location.nameEn} · ${location.branch.nameEn}`,
              stockVersion: location.stockVersion,
              greenItems: location.greenItems.map((item) => ({
                id: item.id,
                label: `${locale === 'ar' ? item.nameAr : item.nameEn}${item.externalKey ? ` · ${item.externalKey}` : ''}`,
                unit: item.unit,
                available: item.availability.available,
              })),
              roastedItems: location.roastedItems.map((item) => ({
                id: item.id,
                label: `${locale === 'ar' ? item.nameAr : item.nameEn}${item.externalKey ? ` · ${item.externalKey}` : ''}`,
                unit: item.unit,
              })),
            }))}
            roastLevels={ROAST_LEVELS.map((value) => ({ value, label: enumLabel(value, locale) }))}
            labels={{
              location: t('inventoryV2.location'),
              batchNumber: t('f.batchNumber'),
              origin: t('f.origin'),
              greenItem: t('inventoryV2.operations.greenInputItem'),
              roastedItem: t('inventoryV2.operations.roastedOutputItem'),
              available: t('inventoryV2.available'),
              greenInput: t('f.green'),
              roastedOutput: t('f.output'),
              abnormalLoss: t('inventoryV2.operations.abnormalLoss'),
              abnormalLossHint: t('inventoryV2.operations.abnormalLossHint'),
              roastDate: t('f.roastDate'),
              roastLevel: t('f.roastLevel'),
              qcScore: t('f.qc'),
              qcNotes: t('f.qcNotes'),
              noItems: t('inventoryV2.operations.noRoastItems'),
              submit: t('inventoryV2.operations.postRoast'),
            }}
            errors={{
              invalid_input: t('inventoryV2.operations.invalid'),
              invalid_date: t('inventoryV2.operations.invalid'),
              forbidden: t('inventoryV2.operations.forbidden'),
              location_produce_forbidden: t('inventoryV2.operations.forbidden'),
              location_stale: t('inventoryV2.operations.stale'),
              inventory_location_not_configured: t('inventoryV2.operations.notConfigured'),
              stock_insufficient: t('inventoryV2.operations.insufficient'),
              batch_exists: t('err.exists'),
              batch_inventory_unit: t('inventoryV2.operations.roastUnitError'),
              green_inventory: t('inventoryV2.operations.greenItemError'),
              roasted_inventory: t('inventoryV2.operations.roastedItemError'),
            }}
          />
        ) : <EmptyState message={t('inventoryV2.noLocations')} />
      ) : (
        <RecordForm
          action={createBatch}
          fields={batchFields(tk, locale)}
          locale={locale}
          submitLabel={t('create')}
          cancelHref="/admin/records/batches"
          cancelLabel={t('cancel')}
          errors={errors}
        />
      )}
    </>
  );
}
