import { getTranslations } from 'next-intl/server';
import { Plus } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel, FINANCE_TYPES } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { signedEffect, type FinanceEntryLike } from '@/lib/metrics/finance';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { AssignAccountForm } from '@/components/finance/AssignAccountForm';
import { assignImportedAccount } from '@/server/finance/entries';
import { Link } from '@/i18n/navigation';
import type { FinanceType, Prisma } from '@prisma/client';

const input = 'rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function active(e: { reversedAt: Date | null; reversalOfId: string | null }) {
  return !e.reversedAt && !e.reversalOfId;
}

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:finance');
  const rawParams = await searchParams;
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const tc = await getTranslations('common');
  const q = one(rawParams.q).trim();
  const type = one(rawParams.type);
  const status = one(rawParams.status);
  const accountId = one(rawParams.accountId);
  const partyId = one(rawParams.partyId);
  const branchId = one(rawParams.branchId);
  const sort = one(rawParams.sort) || 'date_desc';
  const currentParams = new URLSearchParams();
  for (const [key, value] of Object.entries({ q, type, status, accountId, partyId, branchId, sort })) {
    if (value) currentParams.set(key, value);
  }

  const and: Prisma.FinanceEntryWhereInput[] = [];
  if (q) {
    and.push({
      OR: [
        { id: { contains: q } },
        { reference: { contains: q } },
        { description: { contains: q } },
        { importKey: { contains: q } },
        { orderId: { contains: q } },
        { party: { name: { contains: q } } },
      ],
    });
  }
  if (FINANCE_TYPES.includes(type as FinanceType)) and.push({ type: type as FinanceType });
  if (accountId) and.push({ OR: [{ accountId }, { toAccountId: accountId }] });
  if (partyId) and.push({ partyId });
  if (branchId) and.push({ branchId });
  if (status === 'paid') and.push({ obligation: false, reversedAt: null, reversalOfId: null });
  if (status === 'due') and.push({ obligation: true, reversedAt: null, reversalOfId: null });
  if (status === 'reversed') and.push({ reversedAt: { not: null } });
  if (status === 'reversal') and.push({ reversalOfId: { not: null } });
  const where: Prisma.FinanceEntryWhereInput = and.length ? { AND: and } : {};
  const orderBy: Prisma.FinanceEntryOrderByWithRelationInput =
    sort === 'date_asc' ? { date: 'asc' }
    : sort === 'amount_desc' ? { amount: 'desc' }
    : sort === 'amount_asc' ? { amount: 'asc' }
    : sort === 'type' ? { type: 'asc' }
    : { date: 'desc' };

  const [entries, accounts, parties, branches, users] = await Promise.all([
    prisma.financeEntry.findMany({
      where,
      orderBy,
      take: 500,
      include: {
        party: { select: { name: true } },
        account: { select: { name: true } },
        toAccount: { select: { name: true } },
      },
    }),
    prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, currency: true } }),
    prisma.party.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { nameEn: 'asc' }, select: { id: true, nameEn: true, nameAr: true } }),
    prisma.user.findMany({ select: { id: true, name: true, email: true } }),
  ]);
  entries.sort((a, b) => {
    if (sort === 'date_asc') return a.date.getTime() - b.date.getTime();
    if (sort === 'amount_desc') return b.amount - a.amount;
    if (sort === 'amount_asc') return a.amount - b.amount;
    if (sort === 'type') return enumLabel(a.type, locale).localeCompare(enumLabel(b.type, locale));
    return b.date.getTime() - a.date.getTime();
  });
  const accountOptions = accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }));
  const partyOptions = parties.map((p) => ({ value: p.id, label: p.name }));
  const branchOptions = branches.map((b) => ({ value: b.id, label: locale === 'ar' ? b.nameAr : b.nameEn }));
  const branchName = new Map(branchOptions.map((b) => [b.value, b.label]));
  const userName = new Map(users.map((u) => [u.id, u.name || u.email]));

  const cols: Column[] = [
    { label: t('f.transactionId') },
    { label: t('f.date') },
    { label: t('f.type') },
    { label: t('f.moneyIn'), align: 'end' },
    { label: t('f.moneyOut'), align: 'end' },
    { label: t('f.account') },
    { label: t('f.party') },
    { label: t('f.category') },
    { label: t('f.branch') },
    { label: t('f.related') },
    { label: t('f.createdBy') },
    { label: t('f.status') },
    { label: '', align: 'end' },
  ];
  const rows = entries.map((e) => {
    const movement = e as FinanceEntryLike;
    const effect = signedEffect(movement);
    const moneyIn = active(e) && !e.obligation && (effect > 0 || e.type === 'TRANSFER') ? formatMoney(e.amount, e.currency, locale) : '—';
    const moneyOut = active(e) && !e.obligation && (effect < 0 || e.type === 'TRANSFER') ? formatMoney(e.amount, e.currency, locale) : '—';
    const account = e.type === 'TRANSFER'
      ? `${e.account?.name ?? '—'} → ${e.toAccount?.name ?? '—'}`
      : e.account?.name ?? '—';
    const related = e.orderId ?? e.importKey ?? e.reference ?? '—';
    const statusBadge = e.reversalOfId ? (
      <Badge key="s" variant="muted">{t('reversalMarker')}</Badge>
    ) : e.reversedAt ? (
      <Badge key="s" variant="danger">{t('reversed')}</Badge>
    ) : (
      <Badge key="s" variant={e.obligation ? 'warning' : 'success'}>{e.obligation ? t('f.due') : t('f.paid')}</Badge>
    );
    return [
      <span key="id" className="font-mono text-xs">{e.id.slice(-8)}</span>,
      formatDate(e.date, locale),
      enumLabel(e.type, locale),
      moneyIn,
      moneyOut,
      account,
      e.party?.name ?? '—',
      e.categoryType ? enumLabel(e.categoryType, locale) : '—',
      e.branchId ? branchName.get(e.branchId) ?? '—' : '—',
      related,
      e.createdById ? userName.get(e.createdById) ?? e.createdById.slice(-8) : '—',
      statusBadge,
      <Link key="o" href={`/finance/ledger/${e.id}`} className="font-medium text-primary hover:underline">
        {tr('open')}
      </Link>,
    ];
  });
  const exportHref = `/api/finance/export?type=ledger&locale=${locale}${currentParams.toString() ? `&${currentParams.toString()}` : ''}`;

  return (
    <>
      <BackLink href="/finance" label={tr('back')} />
      <div className="flex items-center justify-between gap-3">
        <PageHeader title={t('ledger')} subtitle={tr('total', { n: entries.length })} />
        <Link
          href="/finance/ledger/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
        >
          <Plus className="size-4" />
          {tr('add')}
        </Link>
      </div>
      <AssignAccountForm
        action={assignImportedAccount}
        locale={locale}
        accounts={accountOptions}
        labels={{ title: t('assignAccount'), hint: t('assignHint'), apply: t('apply') }}
      />
      <form className="grid gap-2 rounded-[var(--radius)] border bg-card p-3 md:grid-cols-4 xl:grid-cols-7">
        <input name="q" defaultValue={q} placeholder={tc('search')} className={input} />
        <select name="type" defaultValue={type} className={input}>
          <option value="">{tc('all')}</option>
          {FINANCE_TYPES.map((v) => <option key={v} value={v}>{enumLabel(v, locale)}</option>)}
        </select>
        <select name="status" defaultValue={status} className={input}>
          <option value="">{tc('all')}</option>
          <option value="paid">{t('f.paid')}</option>
          <option value="due">{t('f.due')}</option>
          <option value="reversed">{t('reversed')}</option>
          <option value="reversal">{t('reversalMarker')}</option>
        </select>
        <select name="accountId" defaultValue={accountId} className={input}>
          <option value="">{t('f.account')}</option>
          {accountOptions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        <select name="partyId" defaultValue={partyId} className={input}>
          <option value="">{t('f.party')}</option>
          {partyOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select name="branchId" defaultValue={branchId} className={input}>
          <option value="">{t('f.branch')}</option>
          {branchOptions.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
        <select name="sort" defaultValue={sort} className={input}>
          <option value="date_desc">{t('sortDateDesc')}</option>
          <option value="date_asc">{t('sortDateAsc')}</option>
          <option value="amount_desc">{t('sortAmountDesc')}</option>
          <option value="amount_asc">{t('sortAmountAsc')}</option>
          <option value="type">{t('sortType')}</option>
        </select>
        <div className="flex gap-2 md:col-span-4 xl:col-span-7">
          <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95">
            {tc('apply')}
          </button>
          <Link href="/finance/ledger" className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted">
            {tc('reset')}
          </Link>
        </div>
      </form>
      <DataTable
        columns={cols}
        rows={rows}
        emptyLabel={tr('none')}
        exportHref={exportHref}
        exportLabel={tc('exportCsv')}
      />
    </>
  );
}
