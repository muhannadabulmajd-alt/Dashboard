import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatNumber } from '@/lib/money';
import { PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { Link } from '@/i18n/navigation';

export default async function InventoryRecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:inventory');
  const t = await getTranslations('records');
  const items = await prisma.inventoryItem.findMany({
    orderBy: { category: 'asc' },
    include: { movements: { select: { quantity: true } } },
  });

  const cols: Column[] = [
    { label: t('f.item') },
    { label: t('f.category') },
    { label: t('f.unit') },
    { label: t('f.currentStock'), align: 'end' },
    { label: '', align: 'end' },
  ];

  const rows = items.map((it) => {
    const name = locale === 'ar' ? it.nameAr : it.nameEn;
    const current = it.movements.reduce((s, m) => s + m.quantity, 0);
    return [
      name,
      enumLabel(it.category, locale),
      it.unit,
      formatNumber(current, locale),
      <Link key="o" href={`/admin/records/inventory/${it.id}`} className="font-medium text-primary hover:underline">
        {t('open')}
      </Link>,
    ];
  });

  return (
    <>
      <BackLink href="/admin/records" label={t('back')} />
      <PageHeader title={t('entities.inventory')} subtitle={t('total', { n: items.length })} />
      <DataTable columns={cols} rows={rows} emptyLabel={t('none')} />
    </>
  );
}
