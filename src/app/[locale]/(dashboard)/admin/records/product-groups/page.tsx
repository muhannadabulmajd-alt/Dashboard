import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatNumber } from '@/lib/money';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { Plus } from 'lucide-react';
import { BackLink } from '@/components/records/parts';
import { Link } from '@/i18n/navigation';

export default async function ProductGroupsRecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:products');
  const t = await getTranslations('records');
  const groups = await prisma.productGroup.findMany({
    orderBy: { code: 'asc' },
    include: { _count: { select: { products: true } } },
  });

  const cols: Column[] = [
    { label: t('f.code') },
    { label: t('f.name') },
    { label: t('f.productLine') },
    { label: t('f.variations'), align: 'end' },
    { label: t('f.status') },
    { label: '', align: 'end' },
  ];
  const rows = groups.map((g) => [
    <span key="c" className="font-mono text-xs text-muted-foreground">{g.code}</span>,
    locale === 'ar' ? g.nameAr : g.nameEn,
    enumLabel(g.productLine, locale),
    formatNumber(g._count.products, locale),
    <Badge key="s" variant={g.isActive ? 'success' : 'muted'}>
      {g.isActive ? t('f.active') : t('f.inactive')}
    </Badge>,
    <Link key="o" href={`/admin/records/product-groups/${g.id}`} className="font-medium text-primary hover:underline">
      {t('open')}
    </Link>,
  ]);

  return (
    <>
      <BackLink href="/admin/records" label={t('back')} />
      <div className="flex items-center justify-between gap-3">
        <PageHeader title={t('entities.productGroups')} subtitle={t('total', { n: groups.length })} />
        <Link
          href="/admin/records/product-groups/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
        >
          <Plus className="size-4" />
          {t('add')}
        </Link>
      </div>
      <DataTable columns={cols} rows={rows} emptyLabel={t('none')} />
    </>
  );
}
