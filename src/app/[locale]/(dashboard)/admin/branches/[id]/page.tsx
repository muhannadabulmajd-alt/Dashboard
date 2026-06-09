import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatDate } from '@/lib/dates';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { RecordActions } from '@/components/records/RecordActions';
import { archiveBranch, deleteBranch } from '@/server/branches/actions';

const yes = (b: boolean, t: (k: string) => string) => (b ? t('yes') : t('no'));

export default async function BranchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:branches');
  const { id } = await params;
  const t = await getTranslations('branches');
  const tr = await getTranslations('records');
  const b = await prisma.branch.findUnique({ where: { id } });
  if (!b) notFound();

  const isFranchise = b.branchType === 'FRANCHISE';
  const items: DetailField[] = [
    { label: t('code'), value: b.code },
    { label: t('nameEn'), value: `${b.nameEn} / ${b.nameAr}` },
    { label: t('type'), value: <Badge variant={isFranchise ? 'default' : b.branchType === 'HQ' ? 'success' : 'muted'}>{t(`types.${b.branchType}`)}</Badge> },
    { label: t('governorate'), value: enumLabel(b.governorate, locale) },
    { label: t('city'), value: b.city },
    { label: t('address'), value: b.address },
    { label: t('street'), value: b.street },
    { label: t('phone'), value: b.phone },
    { label: t('email'), value: b.email },
    { label: t('managerName'), value: b.managerName },
    { label: t('managerPhone'), value: b.managerPhone },
    { label: t('managerEmail'), value: b.managerEmail },
    ...(isFranchise
      ? [
          { label: t('franchiseeName'), value: b.franchiseeName },
          { label: t('franchiseePhone'), value: b.franchiseePhone },
          { label: t('franchiseeEmail'), value: b.franchiseeEmail },
          { label: t('agreementStart'), value: b.agreementStart ? formatDate(b.agreementStart, locale) : '—' },
          { label: t('agreementEnd'), value: b.agreementEnd ? formatDate(b.agreementEnd, locale) : '—' },
        ]
      : []),
    { label: t('openingDate'), value: b.openingDate ? formatDate(b.openingDate, locale) : '—' },
    { label: t('operatingHours'), value: b.operatingHours },
    { label: t('hasDelivery'), value: yes(b.hasDelivery, t) },
    { label: t('hasPos'), value: yes(b.hasPos, t) },
    { label: t('trackInventory'), value: yes(b.trackInventory, t) },
    { label: t('hasWarehouse'), value: yes(b.hasWarehouse, t) },
    { label: t('notes'), value: b.notes },
    { label: t('status'), value: <Badge variant={b.isActive ? 'success' : 'muted'}>{b.isActive ? t('active') : t('inactive')}</Badge> },
  ];

  return (
    <>
      <BackLink href="/admin/branches" label={tr('back')} />
      <PageHeader title={locale === 'ar' ? b.nameAr : b.nameEn} subtitle={b.code} />
      <RecordActions
        editHref={`/admin/branches/${b.id}/edit`}
        isActive={b.isActive}
        archiveAction={archiveBranch.bind(null, b.id, locale, !b.isActive)}
        deleteAction={deleteBranch.bind(null, b.id, locale)}
        labels={{ edit: tr('edit'), archive: tr('archive'), restore: tr('restore'), delete: tr('delete'), confirm: tr('confirmDelete') }}
      />
      <DetailGrid items={items} />
    </>
  );
}
