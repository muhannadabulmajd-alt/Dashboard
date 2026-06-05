import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/data-table/DataTable';
import { CreateBranchForm } from './CreateBranchForm';

export default async function BranchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:branches');
  const t = await getTranslations('branches');

  const branches = await prisma.branch.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, code: true, nameEn: true, nameAr: true, governorate: true, isFranchise: true, isActive: true },
  });

  const cols = [
    { label: t('code') },
    { label: t('nameEn') },
    { label: t('governorate') },
    { label: t('type') },
    { label: t('status') },
  ];
  const rows = branches.map((b) => [
    b.code,
    locale === 'ar' ? b.nameAr : b.nameEn,
    enumLabel(b.governorate, locale),
    <Badge key="t" variant={b.isFranchise ? 'default' : 'muted'}>
      {b.isFranchise ? t('franchiseTag') : t('hq')}
    </Badge>,
    <Badge key="s" variant={b.isActive ? 'success' : 'muted'}>
      {b.isActive ? t('active') : t('inactive')}
    </Badge>,
  ]);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('create')}</h3>
        <CreateBranchForm />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('existing')}</h3>
        <DataTable columns={cols} rows={rows} emptyLabel="—" />
      </section>
    </>
  );
}
