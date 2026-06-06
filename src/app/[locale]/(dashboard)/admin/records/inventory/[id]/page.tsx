import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney, formatNumber } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { DataTable, type Column } from '@/components/data-table/DataTable';

export default async function InventoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:inventory');
  const { id } = await params;
  const t = await getTranslations('records');
  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    include: { movements: { orderBy: { occurredAt: 'desc' } } },
  });
  if (!item) notFound();

  const name = locale === 'ar' ? item.nameAr : item.nameEn;
  const current = item.movements.reduce((s, m) => s + m.quantity, 0);

  const items: DetailField[] = [
    { label: t('f.item'), value: `${item.nameEn} / ${item.nameAr}` },
    { label: t('f.category'), value: enumLabel(item.category, locale) },
    { label: t('f.unit'), value: item.unit },
    { label: t('f.currentStock'), value: formatNumber(current, locale) },
    {
      label: t('f.reorderPoint'),
      value: item.reorderPoint != null ? formatNumber(item.reorderPoint, locale) : '—',
    },
    {
      label: t('f.avgDailyUsage'),
      value: item.avgDailyUsage != null ? formatNumber(item.avgDailyUsage, locale) : '—',
    },
    {
      label: t('f.unitCost'),
      value: item.unitCost != null ? formatMoney(item.unitCost, 'IQD', locale) : '—',
    },
  ];

  const mCols: Column[] = [
    { label: t('f.occurredAt') },
    { label: t('f.reason') },
    { label: t('f.quantity'), align: 'end' },
  ];

  const mRows = item.movements.map((m) => [
    formatDate(m.occurredAt, locale),
    enumLabel(m.reason, locale),
    formatNumber(m.quantity, locale),
  ]);

  return (
    <>
      <BackLink href="/admin/records/inventory" label={t('back')} />
      <PageHeader title={name} subtitle={enumLabel(item.category, locale)} />
      <DetailGrid items={items} />
      <div className="mt-4 space-y-2">
        <h3 className="text-sm font-semibold">{t('f.movements')}</h3>
        <DataTable columns={mCols} rows={mRows} emptyLabel={t('none')} />
      </div>
    </>
  );
}
