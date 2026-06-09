import { getTranslations } from 'next-intl/server';
import { Plus } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { SectionGuide } from '@/components/records/SectionGuide';
import { Link } from '@/i18n/navigation';

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
    select: { id: true, code: true, nameEn: true, nameAr: true, branchType: true, governorate: true, isActive: true },
  });

  const cols: Column[] = [
    { label: t('code') },
    { label: t('nameEn') },
    { label: t('type') },
    { label: t('governorate') },
    { label: t('status') },
    { label: '', align: 'end' },
  ];
  const rows = branches.map((b) => [
    <span key="c" className="font-mono text-xs text-muted-foreground">{b.code}</span>,
    locale === 'ar' ? b.nameAr : b.nameEn,
    <Badge key="t" variant={b.branchType === 'FRANCHISE' ? 'default' : b.branchType === 'HQ' ? 'success' : 'muted'}>
      {t(`types.${b.branchType}`)}
    </Badge>,
    enumLabel(b.governorate, locale),
    <Badge key="s" variant={b.isActive ? 'success' : 'muted'}>{b.isActive ? t('active') : t('inactive')}</Badge>,
    <Link key="o" href={`/admin/branches/${b.id}`} className="font-medium text-primary hover:underline">{t('open')}</Link>,
  ]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <Link
          href="/admin/branches/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
        >
          <Plus className="size-4" />
          {t('create')}
        </Link>
      </div>
      <SectionGuide title={t('guide.title')} intro={t('guide.intro')} points={t.raw('guide.points') as string[]} />
      <DataTable columns={cols} rows={rows} emptyLabel="—" />
    </>
  );
}
