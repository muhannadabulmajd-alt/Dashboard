import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink, DetailGrid } from '@/components/records/parts';
import { PageHeader } from '@/components/ui/primitives';
import { formatDate } from '@/lib/dates';
import { formatNumber, formatQuantity } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import { getPageContext } from '@/server/page-context';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import { getPackingDetailData } from '@/server/inventory-v2/operations-read';

export default async function PackingRunDetailPage({
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
  const batch = await getPackingDetailData(user, id);
  if (!batch) notFound();
  const canViewCost = ['OWNER', 'ADMIN', 'FINANCE', 'ROASTERY_OPS'].includes(user.role);
  const columns: Column[] = [
    { label: t('inventoryV2.operations.item') },
    { label: t('inventoryV2.operations.lotNumber') },
    { label: t('inventoryV2.operations.quantity'), align: 'end' },
    ...(canViewCost ? [
      { label: t('inventoryV2.operations.unitCost'), align: 'end' as const },
      { label: t('inventoryV2.operations.totalCost'), align: 'end' as const },
    ] : []),
  ];
  const rows = batch.components.map((component) => [
    locale === 'ar' ? component.inventoryItem.nameAr : component.inventoryItem.nameEn,
    component.costLayer?.lotNumber ?? '—',
    `${formatQuantity(component.quantity, locale)} ${component.inventoryItem.unit}`,
    ...(canViewCost ? [
      `${formatNumber(component.unitCost, locale, 3)} IQD`,
      `${formatNumber(Number(component.quantity) * Number(component.unitCost), locale, 3)} IQD`,
    ] : []),
  ]);

  return (
    <>
      <BackLink href="/admin/records/inventory/packing" label={t('back')} />
      <PageHeader title={batch.batchNumber} subtitle={`${batch.product.sku} · ${locale === 'ar' ? batch.product.nameAr : batch.product.nameEn}`} />
      <DetailGrid items={[
        { label: t('inventoryV2.location'), value: locale === 'ar' ? batch.location.nameAr : batch.location.nameEn },
        { label: t('f.branch'), value: locale === 'ar' ? batch.location.branch.nameAr : batch.location.branch.nameEn },
        { label: t('inventoryV2.operations.packedAt'), value: formatDate(batch.packedAt, locale) },
        { label: t('inventoryV2.operations.bestBefore'), value: batch.bestBefore ? formatDate(batch.bestBefore, locale) : '—' },
        { label: t('inventoryV2.operations.outputQuantity'), value: `${formatQuantity(batch.outputQuantity, locale)} ${batch.outputInventoryItem.unit}` },
        { label: t('inventoryV2.operations.rejectedQuantity'), value: formatQuantity(batch.rejectedQuantity, locale) },
        { label: t('inventoryV2.operations.recipeVersion'), value: batch.recipeVersion?.version ?? '—' },
        { label: t('inventoryV2.operations.lotNumber'), value: batch.outputLot?.lotNumber ?? '—' },
        ...(canViewCost ? [
          { label: t('inventoryV2.operations.totalCost'), value: `${formatNumber(batch.totalCost, locale, 3)} IQD` },
          { label: t('inventoryV2.operations.unitCost'), value: `${formatNumber(batch.unitCost, locale, 3)} IQD` },
        ] : []),
        { label: t('inventoryV2.operations.createdBy'), value: batch.operator?.name ?? '—' },
        {
          label: t('inventoryV2.operations.document'),
          value: (
            <Link href={`/admin/records/inventory/documents/${batch.stockDocument.id}`} className="font-semibold text-primary hover:underline">
              {batch.stockDocument.documentNumber}
            </Link>
          ),
        },
        { label: t('inventoryV2.operations.notes'), value: batch.notes ?? '—' },
      ]} />
      <section className="mt-5">
        <h2 className="mb-2 text-base font-semibold">{t('inventoryV2.operations.consumedComponents')}</h2>
        <DataTable columns={columns} rows={rows} emptyLabel={t('none')} />
      </section>
    </>
  );
}
