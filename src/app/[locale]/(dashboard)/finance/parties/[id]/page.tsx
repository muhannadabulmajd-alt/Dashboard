import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney, convertToIqd } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { serializeFilters } from '@/lib/filters';
import { getUsdToIqd } from '@/server/settings';
import { can } from '@/lib/rbac';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { RecordActions } from '@/components/records/RecordActions';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { archiveParty, deleteParty } from '@/server/finance/parties';
import type { Currency } from '@prisma/client';

export default async function FinancePartyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'view:finance');
  const sp = await searchParams;
  const { id } = await params;
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const trf = await getTranslations('records.f');
  const canManage = can(user.role, 'manage:finance');
  const canExport = can(user.role, 'export:financial');
  const statementParams = serializeFilters({
    range: typeof sp.range === 'string' ? sp.range as Parameters<typeof serializeFilters>[0]['range'] : undefined,
    from: typeof sp.from === 'string' ? sp.from : undefined,
    to: typeof sp.to === 'string' ? sp.to : undefined,
  });
  statementParams.set('locale', locale);
  const statementPdfHref = `/api/finance/parties/${id}/statement/pdf?${statementParams.toString()}`;
  const [p, entries, rate] = await Promise.all([
    prisma.party.findUnique({ where: { id } }),
    prisma.financeEntry.findMany({
      where: { OR: [{ partyId: id }, { settles: { is: { partyId: id } } }], archivedAt: null },
      select: {
        id: true,
        date: true,
        type: true,
        amount: true,
        currency: true,
        obligation: true,
        obligationKind: true,
        settlesId: true,
        archivedAt: true,
        reversedAt: true,
        reversalOfId: true,
        dueDate: true,
        description: true,
        reference: true,
      },
      orderBy: { date: 'desc' },
    }),
    getUsdToIqd(),
  ]);
  if (!p) notFound();
  const branch = p.branchId
    ? await prisma.branch.findUnique({ where: { id: p.branchId }, select: { nameEn: true, nameAr: true } })
    : null;
  const branchName = branch ? (locale === 'ar' ? branch.nameAr : branch.nameEn) : '—';

  const iqd = (amount: number, currency: Currency) => convertToIqd(amount, currency, rate);
  const paidByObligation = new Map<string, number>();
  for (const e of entries) {
    if (e.archivedAt || e.reversedAt || e.reversalOfId) continue;
    if (e.settlesId) paidByObligation.set(e.settlesId, (paidByObligation.get(e.settlesId) ?? 0) + iqd(e.amount, e.currency));
  }
  const balances = entries.reduce(
    (acc, e) => {
      if (e.archivedAt || e.reversedAt || e.reversalOfId) return acc;
      if (!e.obligation || !e.obligationKind) return acc;
      const outstanding = Math.max(0, iqd(e.amount, e.currency) - (paidByObligation.get(e.id) ?? 0));
      if (e.obligationKind === 'PAYABLE') acc.payables += outstanding;
      else acc.receivables += outstanding;
      return acc;
    },
    { payables: p.openingPayable, receivables: p.openingReceivable },
  );

  const items: DetailField[] = [
    { label: t('f.name'), value: p.name },
    { label: t('f.type'), value: enumLabel(p.type, locale) },
    { label: t('f.phone'), value: p.phone },
    { label: t('f.email'), value: p.email },
    { label: t('f.address'), value: p.address },
    { label: t('f.branch'), value: branchName },
    { label: t('f.openingPayable'), value: formatMoney(p.openingPayable, 'IQD', locale) },
    { label: t('f.openingReceivable'), value: formatMoney(p.openingReceivable, 'IQD', locale) },
    { label: t('payables'), value: formatMoney(balances.payables, 'IQD', locale) },
    { label: t('receivables'), value: formatMoney(balances.receivables, 'IQD', locale) },
    { label: t('f.equityShare'), value: p.equityShare != null ? `${p.equityShare}%` : '—' },
    { label: t('f.notes'), value: p.notes },
    {
      label: t('f.status'),
      value: (
        <Badge variant={p.isActive ? 'success' : 'muted'}>{p.isActive ? trf('active') : trf('inactive')}</Badge>
      ),
    },
  ];
  const cols: Column[] = [
    { label: t('f.date') },
    { label: t('f.type') },
    { label: t('f.description') },
    { label: t('f.amount'), align: 'end' },
    { label: t('f.dueDate') },
  ];
  const rows = entries.map((e) => [
    formatDate(e.date, locale),
    enumLabel(e.type, locale),
    e.reversalOfId ? t('reversalMarker') : e.reversedAt ? t('reversed') : e.description ?? e.reference ?? '—',
    formatMoney(e.amount, e.currency, locale),
    e.dueDate ? formatDate(e.dueDate, locale) : '—',
  ]);

  return (
    <>
      <BackLink href="/finance/parties" label={tr('back')} />
      <PageHeader title={p.name} subtitle={t('parties')} />
      {canManage ? (
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
      ) : null}
      <DetailGrid items={items} />
      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('statement')}</h3>
          {canExport ? (
            <div className="flex gap-2">
              <a href={statementPdfHref} className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-muted">
                {t('downloadPdf')}
              </a>
              <a href={statementPdfHref} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-muted">
                {t('print')}
              </a>
            </div>
          ) : null}
        </div>
        <DataTable columns={cols} rows={rows} emptyLabel={tr('none')} />
      </div>
    </>
  );
}
