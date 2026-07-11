import { ArrowDownRight, ArrowUpRight, Plus, UserPlus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/rbac';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { KpiCard } from '@/components/kpi/KpiCard';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { Link } from '@/i18n/navigation';

type CapitalAgg = {
  contributed: number;
  withdrawn: number;
  contributionCount: number;
  withdrawalCount: number;
};

const activeEntryWhere = {
  archivedAt: null,
  reversedAt: null,
  reversalOfId: null,
};

function emptyAgg(): CapitalAgg {
  return { contributed: 0, withdrawn: 0, contributionCount: 0, withdrawalCount: 0 };
}

function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-IQ' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function movementLabel(type: 'CAPITAL_IN' | 'DRAWING', locale: string): string {
  if (type === 'CAPITAL_IN') return locale === 'ar' ? 'مساهمة رأس مال' : 'Capital contribution';
  return locale === 'ar' ? 'سحب مساهم' : 'Shareholder withdrawal';
}

function actionLink(href: string, label: string) {
  return (
    <Link className="font-semibold text-primary hover:underline" href={href}>
      {label}
    </Link>
  );
}

export default async function ShareholdersPage({
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

  const [shareholders, movements] = await Promise.all([
    prisma.party.findMany({
      where: { type: 'SHAREHOLDER' },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, equityShare: true, isActive: true },
    }),
    prisma.financeEntry.findMany({
      where: {
        type: { in: ['CAPITAL_IN', 'DRAWING'] },
        currency: 'IQD',
        ...activeEntryWhere,
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        date: true,
        type: true,
        amount: true,
        reference: true,
        description: true,
        partyId: true,
        account: { select: { name: true } },
        party: { select: { id: true, name: true, isActive: true } },
      },
    }),
  ]);

  const byParty = new Map<string, CapitalAgg>();
  const unassigned = emptyAgg();

  for (const movement of movements) {
    const target = movement.partyId ? byParty.get(movement.partyId) ?? emptyAgg() : unassigned;
    if (movement.type === 'CAPITAL_IN') {
      target.contributed += movement.amount;
      target.contributionCount += 1;
    } else {
      target.withdrawn += movement.amount;
      target.withdrawalCount += 1;
    }
    if (movement.partyId) byParty.set(movement.partyId, target);
  }

  const totalCapital = movements.filter((entry) => entry.type === 'CAPITAL_IN').reduce((sum, entry) => sum + entry.amount, 0);
  const ownerWithdrawals = movements.filter((entry) => entry.type === 'DRAWING').reduce((sum, entry) => sum + entry.amount, 0);
  const netOwnerCapital = totalCapital - ownerWithdrawals;
  const unassignedTotal = unassigned.contributed + unassigned.withdrawn;

  const summaryColumns: Column[] = [
    { label: t('f.name') },
    { label: t('f.status') },
    { label: t('contributions'), align: 'end' },
    { label: t('capitalIn'), align: 'end' },
    { label: t('shareholderWithdrawals'), align: 'end' },
    { label: t('netOwnerCapital'), align: 'end' },
    { label: t('f.equityShare'), align: 'end' },
    { label: t('actions'), align: 'end' },
  ];

  const summaryRows = shareholders.map((shareholder) => {
    const agg = byParty.get(shareholder.id) ?? emptyAgg();
    const net = agg.contributed - agg.withdrawn;
    const pct = shareholder.equityShare ?? (totalCapital > 0 ? (agg.contributed / totalCapital) * 100 : 0);
    return [
      <span key="name" className="font-semibold text-foreground">{shareholder.name}</span>,
      <Badge key="status" variant={shareholder.isActive ? 'success' : 'muted'}>
        {shareholder.isActive ? t('active') : t('inactive')}
      </Badge>,
      String(agg.contributionCount + agg.withdrawalCount),
      formatMoney(agg.contributed, 'IQD', locale),
      formatMoney(agg.withdrawn, 'IQD', locale),
      <span key="net" className={net >= 0 ? 'font-semibold text-success' : 'font-semibold text-danger'}>
        {formatMoney(net, 'IQD', locale)}
      </span>,
      `${pct.toFixed(1)}%`,
      canManage ? (
        <div key="actions" className="flex justify-end gap-2">
          {actionLink(`/finance/ledger/new?kind=CAPITAL_IN&partyId=${shareholder.id}`, t('addContribution'))}
          {actionLink(`/finance/ledger/new?kind=DRAWING&partyId=${shareholder.id}`, t('recordWithdrawal'))}
        </div>
      ) : '—',
    ];
  });

  const movementColumns: Column[] = [
    { label: t('f.date') },
    { label: t('shareholder') },
    { label: t('f.type') },
    { label: t('f.account') },
    { label: t('f.reference') },
    { label: t('f.description') },
    { label: t('f.amount'), align: 'end' },
    { label: t('actions'), align: 'end' },
  ];

  const movementRows = movements.map((movement) => {
    const isContribution = movement.type === 'CAPITAL_IN';
    const partyName = movement.party?.name ?? t('needsShareholder');
    return [
      formatDate(movement.date, locale),
      <span key="party" className={movement.party ? 'font-medium text-foreground' : 'font-semibold text-warning'}>
        {partyName}
      </span>,
      <span key="type" className="inline-flex items-center gap-1.5">
        {isContribution ? <ArrowUpRight className="size-3.5 text-success" /> : <ArrowDownRight className="size-3.5 text-danger" />}
        {movementLabel(movement.type as 'CAPITAL_IN' | 'DRAWING', locale)}
      </span>,
      movement.account?.name ?? '—',
      movement.reference ?? '—',
      movement.description ?? '—',
      <span key="amount" className={isContribution ? 'font-semibold text-success' : 'font-semibold text-danger'}>
        {formatMoney(movement.amount, 'IQD', locale)}
      </span>,
      <div key="actions" className="flex justify-end gap-2">
        {actionLink(`/finance/ledger/${movement.id}`, tr('open'))}
        {canManage ? actionLink(`/finance/ledger/${movement.id}/edit`, tr('edit')) : null}
      </div>,
    ];
  });

  return (
    <>
      <BackLink href="/finance" label={t('shareholders')} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title={t('shareholdersTitle')} subtitle={t('shareholdersSubtitle')} />
        {canManage ? (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Link
              href="/finance/parties/new?type=SHAREHOLDER"
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 py-2 text-sm font-semibold text-roast hover:bg-linen/45"
            >
              <UserPlus className="size-4" />
              {t('addShareholder')}
            </Link>
            <Link
              href="/finance/ledger/new?kind=CAPITAL_IN"
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-amber/90"
            >
              <Plus className="size-4" />
              {t('addContribution')}
            </Link>
            <Link
              href="/finance/ledger/new?kind=DRAWING"
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 py-2 text-sm font-semibold text-roast hover:bg-linen/45"
            >
              <ArrowDownRight className="size-4" />
              {t('recordWithdrawal')}
            </Link>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard locale={locale} label={t('totalCapital')} value={formatMoney(totalCapital, 'IQD', locale)} tone="success" />
        <KpiCard locale={locale} label={t('ownerWithdrawals')} value={formatMoney(ownerWithdrawals, 'IQD', locale)} tone="danger" />
        <KpiCard locale={locale} label={t('netOwnerCapital')} value={formatMoney(netOwnerCapital, 'IQD', locale)} tone={netOwnerCapital >= 0 ? 'accent' : 'danger'} />
      </div>

      {unassignedTotal > 0 ? (
        <div className="rounded-[var(--radius)] border border-warning/35 bg-warning-soft px-4 py-3 text-sm text-warning">
          <p className="font-semibold">{t('unassignedCapitalTitle')}</p>
          <p className="mt-1 leading-6 text-roast">{t('unassignedCapitalHint', { amount: formatMoney(unassignedTotal, 'IQD', locale) })}</p>
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">{t('shareholderBalances')}</h2>
        <DataTable
          columns={summaryColumns}
          rows={summaryRows}
          emptyTitle={t('noShareholders')}
          emptyLabel={t('noShareholdersHint')}
          emptyActionHref={canManage ? '/finance/parties/new?type=SHAREHOLDER' : undefined}
          emptyActionLabel={canManage ? t('addShareholder') : undefined}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">{t('capitalMovements')}</h2>
        <DataTable
          columns={movementColumns}
          rows={movementRows}
          emptyTitle={t('noCapitalMovements')}
          emptyLabel={t('noCapitalMovementsHint')}
          emptyActionHref={canManage ? '/finance/ledger/new?kind=CAPITAL_IN' : undefined}
          emptyActionLabel={canManage ? t('addContribution') : undefined}
        />
      </section>
    </>
  );
}
