import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { RecordActions } from '@/components/records/RecordActions';
import { archiveCustomer, deleteCustomer } from '@/server/records/customers';
import { formatDate } from '@/lib/dates';

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:customers');
  const { id } = await params;
  const t = await getTranslations('records');
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) notFound();

  const name = (locale === 'ar' ? c.nameAr : c.nameEn) || c.nameEn || c.nameAr || c.externalId || '—';
  const items: DetailField[] = [
    { label: t('f.externalId'), value: c.externalId },
    { label: t('f.name'), value: `${c.nameEn ?? ''} / ${c.nameAr ?? ''}` },
    { label: t('f.phone'), value: c.phone },
    { label: t('f.email'), value: c.email },
    { label: t('f.governorate'), value: enumLabel(c.governorate, locale) },
    { label: t('f.address1'), value: c.address1 },
    { label: t('f.street'), value: c.street },
    { label: t('f.segment'), value: enumLabel(c.segment, locale) },
    { label: t('f.source'), value: c.campaignSource },
    { label: t('f.ordersCount'), value: c.ordersCount },
    { label: t('f.firstOrder'), value: c.firstOrderAt ? formatDate(c.firstOrderAt, locale) : '—' },
    { label: t('f.lastOrder'), value: c.lastOrderAt ? formatDate(c.lastOrderAt, locale) : '—' },
    { label: t('f.notes'), value: c.notes },
  ];

  return (
    <>
      <BackLink href="/admin/records/customers" label={t('back')} />
      <PageHeader title={name} subtitle={c.externalId || c.phone || ''} />
      <RecordActions
        editHref={`/admin/records/customers/${c.id}/edit`}
        isActive={c.isActive}
        archiveAction={archiveCustomer.bind(null, c.id, locale, !c.isActive)}
        deleteAction={deleteCustomer.bind(null, c.id, locale)}
        labels={{
          edit: t('edit'),
          archive: t('archive'),
          restore: t('restore'),
          delete: t('delete'),
          confirm: t('confirmDelete'),
        }}
      />
      <DetailGrid items={items} />
    </>
  );
}
