import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { optionalDecimalString } from '@/lib/decimal';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { updateInventory } from '@/server/records/inventory';
import { inventoryFields } from '../../_fields';

export default async function EditInventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:inventory');
  const { id } = await params;
  const t = await getTranslations('records');
  const tk = (k: string) => t(k);
  const [item, productRows] = await Promise.all([
    prisma.inventoryItem.findUnique({ where: { id } }),
    prisma.product.findMany({ where: { isActive: true }, orderBy: { sku: 'asc' } }),
  ]);
  if (!item) notFound();
  const products = productRows.map((p) => ({ value: p.id, label: `${p.sku} · ${locale === 'ar' ? p.nameAr : p.nameEn}` }));

  const initial = {
    nameEn: item.nameEn,
    nameAr: item.nameAr,
    category: item.category,
    unit: item.unit,
    productId: item.productId ?? '',
    reorderPoint: optionalDecimalString(item.reorderPoint),
    avgDailyUsage: item.avgDailyUsage ?? '',
    unitCost: optionalDecimalString(item.unitCost),
  };
  const errors = { invalid: t('err.invalid'), exists: t('err.exists'), forbidden: t('err.forbidden') };

  return (
    <>
      <BackLink href={`/admin/records/inventory/${id}`} label={t('back')} />
      <PageHeader title={t('editTitle', { entity: t('entities.inventory') })} subtitle={enumLabel(item.category, locale)} />
      <RecordForm
        action={updateInventory.bind(null, id)}
        fields={inventoryFields(tk, locale, products)}
        initial={initial}
        locale={locale}
        submitLabel={t('save')}
        cancelHref={`/admin/records/inventory/${id}`}
        cancelLabel={t('cancel')}
        errors={errors}
      />
    </>
  );
}
