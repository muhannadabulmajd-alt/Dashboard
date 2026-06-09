import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel, INVENTORY_CATEGORIES } from '@/lib/enums';
import { formatNumber, formatMoney } from '@/lib/money';
import { PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { RecordsSummary, type SummaryStat } from '@/components/records/Summary';
import { TableToolbar } from '@/components/records/TableToolbar';
import { Plus } from 'lucide-react';
import { BackLink } from '@/components/records/parts';
import { SectionGuide } from '@/components/records/SectionGuide';
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

  const currentStock = (it: (typeof items)[number]) => it.movements.reduce((s, m) => s + m.quantity, 0);
  const stockValue = items.reduce((s, it) => s + currentStock(it) * (it.unitCost ?? 0), 0);
  const reorderCount = items.filter((it) => it.reorderPoint != null && currentStock(it) < it.reorderPoint).length;
  const stats: SummaryStat[] = [
    { label: t('k.total'), value: formatNumber(items.length, locale) },
    { label: t('k.stockValue'), value: formatMoney(stockValue, 'IQD', locale) },
    { label: t('k.reorder'), value: formatNumber(reorderCount, locale), tone: reorderCount > 0 ? 'danger' : 'default' },
  ];

  // Inventory is small and stock is computed in JS, so filter/sort in memory.
  const sp = await searchParams;
  const q = (typeof sp.q === 'string' ? sp.q.trim() : '').toLowerCase();
  const cat = typeof sp.category === 'string' ? sp.category : '';
  const sort = typeof sp.sort === 'string' ? sp.sort : '';
  const visible = items
    .filter((it) => {
      const name = `${it.nameEn ?? ''} ${it.nameAr ?? ''}`.toLowerCase();
      return (!q || name.includes(q)) && (!cat || it.category === cat);
    })
    .sort((a, b) => {
      if (sort === 'nameAsc') return (a.nameEn ?? '').localeCompare(b.nameEn ?? '');
      if (sort === 'stockDesc') return currentStock(b) - currentStock(a);
      return 0;
    });
  const sortOpts = ['nameAsc', 'stockDesc'].map((v) => ({ value: v, label: t(`tools.${v}`) }));
  const catOpts = INVENTORY_CATEGORIES.map((c) => ({ value: c, label: enumLabel(c, locale) }));

  const cols: Column[] = [
    { label: t('f.item') },
    { label: t('f.category') },
    { label: t('f.unit') },
    { label: t('f.currentStock'), align: 'end' },
    { label: '', align: 'end' },
  ];

  const rows = visible.map((it) => {
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
      <div className="flex items-center justify-between gap-3">
        <PageHeader title={t('entities.inventory')} subtitle={t('total', { n: items.length })} />
        <Link
          href="/admin/records/inventory/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
        >
          <Plus className="size-4" />
          {t('add')}
        </Link>
      </div>
      <SectionGuide title={t('guide.inventory.title')} intro={t('guide.inventory.intro')} points={t.raw('guide.inventory.points') as string[]} />
      <RecordsSummary stats={stats} />
      <TableToolbar
        searchPlaceholder={t('tools.search')}
        filters={[{ name: 'category', label: t('f.category'), options: catOpts }]}
        sorts={sortOpts}
        sortLabel={t('tools.sort')}
      />
      <DataTable columns={cols} rows={rows} emptyLabel={t('none')} />
    </>
  );
}
