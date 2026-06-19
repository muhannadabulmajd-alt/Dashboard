import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/rbac';
import { PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { Plus } from 'lucide-react';
import { BackLink } from '@/components/records/parts';
import { SectionGuide } from '@/components/records/SectionGuide';
import { Link } from '@/i18n/navigation';
import { accountBalance } from '@/lib/metrics/finance';

export default async function FinanceAccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user, filters, scope, range } = await getPageContext(params, searchParams, 'view:finance');
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const canManage = can(user.role, 'manage:finance');
  const branchWhere = scope.branchId
    ? { branchId: scope.branchId }
    : filters.branchId?.length
      ? { branchId: { in: filters.branchId } }
      : {};
  const [accounts, entries] = await Promise.all([
    prisma.financeAccount.findMany({ where: branchWhere, orderBy: { createdAt: 'asc' } }),
    prisma.financeEntry.findMany({
      where: { date: { lte: range.end }, archivedAt: null, reversedAt: null, reversalOfId: null, ...branchWhere },
      select: { id: true, type: true, amount: true, currency: true, obligation: true, obligationKind: true, accountId: true, toAccountId: true, settlesId: true, archivedAt: true },
    }),
  ]);

  const cols: Column[] = [
    { label: t('f.name') },
    { label: t('f.type') },
    { label: t('f.currency') },
    { label: t('f.balance'), align: 'end' },
    { label: '', align: 'end' },
  ];
  const rows = accounts.map((a) => [
    a.name,
    enumLabel(a.type, locale),
    a.currency,
    formatMoney(accountBalance(a, entries.filter((entry) => entry.currency === a.currency)), a.currency, locale),
    <Link key="o" href={`/finance/accounts/${a.id}`} className="font-medium text-primary hover:underline">
      {tr('open')}
    </Link>,
  ]);

  return (
    <>
      <BackLink href="/finance" label={tr('back')} />
      <div className="flex items-center justify-between gap-3">
        <PageHeader title={t('accounts')} subtitle={tr('total', { n: accounts.length })} />
        {canManage ? (
          <Link
            href="/finance/accounts/new"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
          >
            <Plus className="size-4" />
            {tr('add')}
          </Link>
        ) : null}
      </div>
      <SectionGuide
        title={t('guide.accounts.title')}
        intro={t('guide.accounts.intro')}
        points={t.raw('guide.accounts.points')}
      />
      <DataTable columns={cols} rows={rows} emptyLabel={tr('none')} />
    </>
  );
}
