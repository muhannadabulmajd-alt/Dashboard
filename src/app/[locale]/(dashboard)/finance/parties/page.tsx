import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { can } from '@/lib/rbac';
import { PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { Plus } from 'lucide-react';
import { BackLink } from '@/components/records/parts';
import { SectionGuide } from '@/components/records/SectionGuide';
import { Link } from '@/i18n/navigation';

export default async function FinancePartiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'view:finance');
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const canManage = can(user.role, 'manage:finance');
  const parties = await prisma.party.findMany({ orderBy: { createdAt: 'asc' } });

  const cols: Column[] = [
    { label: t('f.name') },
    { label: t('f.type') },
    { label: t('f.phone') },
    { label: '', align: 'end' },
  ];
  const rows = parties.map((p) => [
    p.name,
    enumLabel(p.type, locale),
    p.phone ?? '—',
    <Link key="o" href={`/finance/parties/${p.id}`} className="font-medium text-primary hover:underline">
      {tr('open')}
    </Link>,
  ]);

  return (
    <>
      <BackLink href="/finance" label={tr('back')} />
      <div className="flex items-center justify-between gap-3">
        <PageHeader title={t('parties')} subtitle={tr('total', { n: parties.length })} />
        {canManage ? (
          <Link
            href="/finance/parties/new"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
          >
            <Plus className="size-4" />
            {tr('add')}
          </Link>
        ) : null}
      </div>
      <SectionGuide
        title={t('guide.parties.title')}
        intro={t('guide.parties.intro')}
        points={t.raw('guide.parties.points')}
      />
      <DataTable columns={cols} rows={rows} emptyLabel={tr('none')} />
    </>
  );
}
