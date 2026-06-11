import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { accountBalance, type FinanceEntryLike } from '@/lib/metrics/finance';
import { can } from '@/lib/rbac';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { RecordActions } from '@/components/records/RecordActions';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { archiveAccount, deleteAccount } from '@/server/finance/accounts';

export default async function FinanceAccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'view:finance');
  const { id } = await params;
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const trf = await getTranslations('records.f');
  const canManage = can(user.role, 'manage:finance');
  const a = await prisma.financeAccount.findUnique({ where: { id } });
  if (!a) notFound();

  const [entries, branch] = await Promise.all([
    prisma.financeEntry.findMany({
      where: { OR: [{ accountId: id }, { toAccountId: id }] },
      select: {
        id: true, type: true, amount: true, currency: true, obligation: true,
        obligationKind: true, accountId: true, toAccountId: true, settlesId: true,
        reversedAt: true, reversalOfId: true,
        date: true, description: true, reference: true, party: { select: { name: true } },
      },
      orderBy: { date: 'desc' },
    }),
    a.branchId ? prisma.branch.findUnique({ where: { id: a.branchId }, select: { nameEn: true, nameAr: true } }) : null,
  ]);
  const balance = accountBalance({ id: a.id, openingBalance: a.openingBalance }, entries as FinanceEntryLike[]);
  const branchName = branch ? (locale === 'ar' ? branch.nameAr : branch.nameEn) : '—';

  const items: DetailField[] = [
    { label: t('f.name'), value: a.name },
    { label: t('f.type'), value: enumLabel(a.type, locale) },
    { label: t('f.currency'), value: a.currency },
    { label: t('f.bank'), value: a.bankName },
    { label: t('f.branch'), value: branchName },
    { label: t('f.opening'), value: formatMoney(a.openingBalance, a.currency, locale) },
    { label: t('f.balance'), value: formatMoney(balance, a.currency, locale) },
    { label: t('f.notes'), value: a.notes ?? '—' },
    {
      label: t('f.status'),
      value: (
        <Badge variant={a.isActive ? 'success' : 'muted'}>{a.isActive ? trf('active') : trf('inactive')}</Badge>
      ),
    },
  ];
  const cols: Column[] = [
    { label: t('f.date') },
    { label: t('f.type') },
    { label: t('f.party') },
    { label: t('f.description') },
    { label: t('f.amount'), align: 'end' },
  ];
  const rows = entries.map((e) => [
    formatDate(e.date, locale),
    enumLabel(e.type, locale),
    e.party?.name ?? '—',
    e.reversalOfId ? t('reversalMarker') : e.reversedAt ? t('reversed') : e.description ?? e.reference ?? '—',
    formatMoney(e.amount, e.currency, locale),
  ]);

  return (
    <>
      <BackLink href="/finance/accounts" label={tr('back')} />
      <PageHeader title={a.name} subtitle={t('accounts')} />
      {canManage ? (
        <RecordActions
          editHref={`/finance/accounts/${a.id}/edit`}
          isActive={a.isActive}
          archiveAction={archiveAccount.bind(null, a.id, locale, !a.isActive)}
          deleteAction={deleteAccount.bind(null, a.id, locale)}
          labels={{
            edit: tr('edit'),
            archive: tr('archive'),
            restore: tr('restore'),
            delete: tr('delete'),
            confirm: tr('confirmDelete'),
          }}
        />
      ) : null}
      <DetailGrid items={items} />
      <div className="mt-4 space-y-2">
        <h3 className="text-sm font-semibold">{t('statement')}</h3>
        <DataTable columns={cols} rows={rows} emptyLabel={tr('none')} />
      </div>
    </>
  );
}
