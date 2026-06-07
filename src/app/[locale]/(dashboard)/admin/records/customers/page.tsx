import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { Plus } from 'lucide-react';
import { BackLink } from '@/components/records/parts';
import { Link } from '@/i18n/navigation';

export default async function CustomersRecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:customers');
  const t = await getTranslations('records');
  const customers = await prisma.customer.findMany({ orderBy: { ordersCount: 'desc' } });

  const cols: Column[] = [
    { label: t('f.name') },
    { label: t('f.phone') },
    { label: t('f.governorate') },
    { label: t('f.segment') },
    { label: t('f.ordersCount'), align: 'end' },
    { label: '', align: 'end' },
  ];
  const rows = customers.map((c) => {
    const name = (locale === 'ar' ? c.nameAr : c.nameEn) || c.nameEn || c.nameAr || c.externalId || '—';
    return [
      name,
      c.phone,
      enumLabel(c.governorate, locale),
      enumLabel(c.segment, locale),
      c.ordersCount,
      <Link key="o" href={`/admin/records/customers/${c.id}`} className="font-medium text-primary hover:underline">
        {t('open')}
      </Link>,
    ];
  });

  return (
    <>
      <BackLink href="/admin/records" label={t('back')} />
      <div className="flex items-center justify-between gap-3">
        <PageHeader title={t('entities.customers')} subtitle={t('total', { n: customers.length })} />
        <Link
          href="/admin/records/customers/new"
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
