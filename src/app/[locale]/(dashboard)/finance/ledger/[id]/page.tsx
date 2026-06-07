import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { RecordActions } from '@/components/records/RecordActions';
import { deleteEntry } from '@/server/finance/entries';

export default async function EntryDetailPage({
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

  const e = await prisma.financeEntry.findUnique({
    where: { id },
    include: { party: true, account: true, toAccount: true },
  });
  if (!e) notFound();

  const items: DetailField[] = [
    { label: t('f.type'), value: enumLabel(e.type, locale) },
    { label: t('f.amount'), value: formatMoney(e.amount, e.currency, locale) },
    { label: t('f.date'), value: formatDate(e.date, locale) },
    {
      label: t('f.status'),
      value: (
        <Badge variant={e.obligation ? 'warning' : 'success'}>{e.obligation ? t('f.due') : t('f.paid')}</Badge>
      ),
    },
    { label: t('f.kind'), value: e.obligationKind ? enumLabel(e.obligationKind, locale) : '—' },
    { label: t('f.dueDate'), value: e.dueDate ? formatDate(e.dueDate, locale) : '—' },
    { label: t('f.account'), value: e.account?.name ?? '—' },
    { label: t('f.toAccount'), value: e.toAccount?.name ?? '—' },
    { label: t('f.party'), value: e.party?.name ?? '—' },
    { label: t('f.category'), value: e.categoryType ? enumLabel(e.categoryType, locale) : '—' },
    { label: t('f.description'), value: e.description ?? '—' },
    { label: t('f.reference'), value: e.reference ?? '—' },
  ];

  return (
    <>
      <BackLink href="/finance/ledger" label={tr('back')} />
      <PageHeader title={enumLabel(e.type, locale)} subtitle={formatMoney(e.amount, e.currency, locale)} />
      <RecordActions
        editHref={`/finance/ledger/${e.id}/edit`}
        deleteAction={deleteEntry.bind(null, e.id, locale)}
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
