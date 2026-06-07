import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { RecordActions } from '@/components/records/RecordActions';
import { archiveParty, deleteParty } from '@/server/finance/parties';

export default async function FinancePartyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:finance');
  const { id } = await params;
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const trf = await getTranslations('records.f');
  const p = await prisma.party.findUnique({ where: { id } });
  if (!p) notFound();

  const items: DetailField[] = [
    { label: t('f.name'), value: p.name },
    { label: t('f.type'), value: enumLabel(p.type, locale) },
    { label: t('f.phone'), value: p.phone },
    { label: t('f.email'), value: p.email },
    { label: t('f.equityShare'), value: p.equityShare != null ? `${p.equityShare}%` : '—' },
    { label: t('f.notes'), value: p.notes },
    {
      label: t('f.status'),
      value: (
        <Badge variant={p.isActive ? 'success' : 'muted'}>{p.isActive ? trf('active') : trf('inactive')}</Badge>
      ),
    },
  ];

  return (
    <>
      <BackLink href="/finance/parties" label={tr('back')} />
      <PageHeader title={p.name} subtitle={t('parties')} />
      <RecordActions
        editHref={`/finance/parties/${p.id}/edit`}
        isActive={p.isActive}
        archiveAction={archiveParty.bind(null, p.id, locale, !p.isActive)}
        deleteAction={deleteParty.bind(null, p.id, locale)}
        labels={{
          edit: tr('edit'),
          archive: tr('archive'),
          restore: tr('restore'),
          delete: tr('delete'),
          confirm: tr('confirmDelete'),
        }}
      />
      <DetailGrid items={items} />
    </>
  );
}
