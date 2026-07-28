import { getTranslations } from 'next-intl/server';
import { Plus } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel, FINANCE_TYPES, PAYMENT_METHODS } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { ledgerPaymentSnapshot, ledgerPaymentStatusLabel } from '@/lib/ledger-lines';
import { ledgerRecordClassLabel } from '@/lib/ledger-record-class';
import { can } from '@/lib/rbac';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { AssignAccountForm } from '@/components/finance/AssignAccountForm';
import { SectionGuide } from '@/components/records/SectionGuide';
import { assignImportedAccount } from '@/server/finance/entries';
import { Link } from '@/i18n/navigation';
import type { FinanceType, LedgerRecordClass, Prisma } from '@prisma/client';

const input = 'rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'view:finance');
  const rawParams = await searchParams;
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const tc = await getTranslations('common');
  const canManage = can(user.role, 'manage:finance');
  const canExport = can(user.role, 'export:financial');
  const q = one(rawParams.q).trim();
  const type = one(rawParams.type);
  const recordClass = one(rawParams.recordClass);
  const status = one(rawParams.status);
  const accountId = one(rawParams.accountId);
  const partyId = one(rawParams.partyId);
  const branchId = one(rawParams.branchId);
  const paymentStatus = one(rawParams.paymentStatus);
  const paymentMethod = one(rawParams.paymentMethod);
  const dateFrom = one(rawParams.dateFrom);
  const dateTo = one(rawParams.dateTo);
  const minAmount = one(rawParams.minAmount);
  const maxAmount = one(rawParams.maxAmount);
  const sort = one(rawParams.sort) || 'date_desc';
  const currentParams = new URLSearchParams();
  for (const [key, value] of Object.entries({ q, type, recordClass, status, accountId, partyId, branchId, paymentStatus, paymentMethod, dateFrom, dateTo, minAmount, maxAmount, sort })) {
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
        { ledgerLines: { some: { itemName: { contains: q } } } },
        { ledgerLines: { some: { inventoryItem: { OR: [{ nameEn: { contains: q } }, { nameAr: { contains: q } }] } } } },
      ],
    });
  }
  if (FINANCE_TYPES.includes(type as FinanceType)) and.push({ type: type as FinanceType });
  if (['PURCHASE', 'EXPENSE', 'MIXED'].includes(recordClass)) and.push({ recordClass: recordClass as LedgerRecordClass });
  if (accountId) and.push({ OR: [{ accountId }, { toAccountId: accountId }] });
  if (partyId) and.push({ partyId });
  if (branchId) and.push({ branchId });
  if (paymentMethod) and.push({ paymentMethod });
  const amountGte = minAmount ? Number(minAmount) : NaN;
  const amountLte = maxAmount ? Number(maxAmount) : NaN;
  if (Number.isFinite(amountGte)) and.push({ amount: { gte: Math.round(amountGte) } });
  if (Number.isFinite(amountLte)) and.push({ amount: { lte: Math.round(amountLte) } });
  const parsedDateFrom = dateFrom ? new Date(dateFrom) : null;
  const parsedDateTo = dateTo ? new Date(dateTo) : null;
  if (parsedDateFrom && !Number.isNaN(parsedDateFrom.getTime())) and.push({ date: { gte: parsedDateFrom } });
  if (parsedDateTo && !Number.isNaN(parsedDateTo.getTime())) {
    parsedDateTo.setHours(23, 59, 59, 999);
    and.push({ date: { lte: parsedDateTo } });
  }
  if (status === 'paid') and.push({ obligation: false, reversedAt: null, reversalOfId: null });
  if (status === 'due') and.push({ obligation: true, reversedAt: null, reversalOfId: null });
  if (status === 'reversed') and.push({ reversedAt: { not: null } });
  if (status === 'reversal') and.push({ reversalOfId: { not: null } });
  if (status === 'archived') and.push({ archivedAt: { not: null } });
  else and.push({ archivedAt: null });
  const where: Prisma.FinanceEntryWhereInput = and.length ? { AND: and } : {};
  const orderBy: Prisma.FinanceEntryOrderByWithRelationInput =
    sort === 'date_asc' ? { date: 'asc' }
    : sort === 'amount_desc' ? { amount: 'desc' }
    : sort === 'amount_asc' ? { amount: 'asc' }
    : sort === 'type' ? { type: 'asc' }
    : { date: 'desc' };

  const [entriesRaw, accounts, parties, branches, users] = await Promise.all([
    prisma.financeEntry.findMany({
      where,
      orderBy,
      take: 500,
      include: {
        party: { select: { name: true } },
        account: { select: { name: true } },
        toAccount: { select: { name: true } },
        settlements: { where: { archivedAt: null, reversedAt: null, reversalOfId: null }, select: { amount: true } },
        ledgerLines: { select: { id: true } },
      },
    }),
    prisma.financeAccount.findMany({
      where: { isActive: true, type: { not: 'PAYMENT_GATEWAY' } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, currency: true },
    }),
    prisma.party.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { nameEn: 'asc' }, select: { id: true, nameEn: true, nameAr: true } }),
    prisma.user.findMany({ select: { id: true, name: true, email: true } }),
  ]);
  const entries = entriesRaw.filter((entry) => {
    if (!paymentStatus) return true;
    const paid = entry.obligation ? entry.settlements.reduce((sum, payment) => sum + payment.amount, 0) : entry.amount;
    const snapshot = ledgerPaymentSnapshot(entry.amount, paid, { reversed: Boolean(entry.reversedAt || entry.reversalOfId) });
    return snapshot.status.toLowerCase() === paymentStatus;
  });
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
    { label: t('f.description') },
    { label: t('f.amount'), align: 'end' },
    { label: t('paidAmount'), align: 'end' },
    { label: t('remainingAmount'), align: 'end' },
    { label: t('f.account') },
    { label: t('f.party') },
    { label: t('f.branch') },
    { label: t('f.related') },
    { label: t('f.createdBy') },
    { label: t('f.status') },
    { label: '', align: 'end' },
  ];
  const rows = entries.map((e) => {
    const account = e.type === 'TRANSFER'
      ? `${e.account?.name ?? '—'} → ${e.toAccount?.name ?? '—'}`
      : e.account?.name ?? '—';
    const related = e.orderId ?? e.importKey ?? e.reference ?? '—';
    const paid = e.obligation ? e.settlements.reduce((sum, payment) => sum + payment.amount, 0) : e.amount;
    const snapshot = ledgerPaymentSnapshot(e.amount, paid, { reversed: Boolean(e.reversedAt || e.reversalOfId) });
    const statusBadge = e.archivedAt ? (
      <Badge key="s" variant="warning">{t('archived')}</Badge>
    ) : e.reversalOfId ? (
      <Badge key="s" variant="muted">{t('reversalMarker')}</Badge>
    ) : e.reversedAt ? (
      <Badge key="s" variant="danger">{t('reversed')}</Badge>
    ) : (
      <Badge key="s" variant={snapshot.status === 'PAID' ? 'success' : snapshot.status === 'PARTIAL' ? 'warning' : 'muted'}>
        {ledgerPaymentStatusLabel(snapshot.status, locale)}
      </Badge>
    );
    return [
      <span key="id" className="font-mono text-xs">{e.id.slice(-8)}</span>,
      formatDate(e.date, locale),
      e.recordClass ? ledgerRecordClassLabel(e.recordClass, locale) : enumLabel(e.type, locale),
      e.description ?? (e.ledgerLines.length ? `${e.ledgerLines.length} ${t('lineItems')}` : '—'),
      formatMoney(e.amount, e.currency, locale),
      formatMoney(snapshot.paid, e.currency, locale),
      formatMoney(snapshot.remaining, e.currency, locale),
      account,
      e.party?.name ?? '—',
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
        {canManage ? (
          <Link
            href="/finance/ledger/new"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
          >
            <Plus className="size-4" />
            {tr('add')}
          </Link>
        ) : null}
      </div>
      <SectionGuide
        title={t('guide.ledger.title')}
        intro={t('guide.ledger.intro')}
        points={t.raw('guide.ledger.points')}
      />
      {canManage ? (
        <AssignAccountForm
          action={assignImportedAccount}
          locale={locale}
          accounts={accountOptions}
          labels={{ title: t('assignAccount'), hint: t('assignHint'), apply: t('apply') }}
        />
      ) : null}
      <form className="grid gap-2 rounded-[var(--radius)] border bg-card p-3 md:grid-cols-4 xl:grid-cols-8">
        <input name="q" defaultValue={q} placeholder={tc('search')} className={input} />
        <select name="type" defaultValue={type} className={input}>
          <option value="">{tc('all')}</option>
          {FINANCE_TYPES.map((v) => <option key={v} value={v}>{enumLabel(v, locale)}</option>)}
        </select>
        <select name="recordClass" defaultValue={recordClass} className={input}>
          <option value="">{locale === 'ar' ? 'كل التصنيفات' : 'All classifications'}</option>
          {(['PURCHASE', 'EXPENSE', 'MIXED'] as const).map((value) => (
            <option key={value} value={value}>{ledgerRecordClassLabel(value, locale)}</option>
          ))}
        </select>
        <select name="status" defaultValue={status} className={input}>
          <option value="">{tc('all')}</option>
          <option value="paid">{t('f.paid')}</option>
          <option value="due">{t('f.due')}</option>
          <option value="archived">{t('archived')}</option>
          <option value="reversed">{t('reversed')}</option>
          <option value="reversal">{t('reversalMarker')}</option>
        </select>
        <select name="paymentStatus" defaultValue={paymentStatus} className={input}>
          <option value="">{t('paymentStatus')}</option>
          <option value="paid">{ledgerPaymentStatusLabel('PAID', locale)}</option>
          <option value="partial">{ledgerPaymentStatusLabel('PARTIAL', locale)}</option>
          <option value="unpaid">{ledgerPaymentStatusLabel('UNPAID', locale)}</option>
        </select>
        <select name="paymentMethod" defaultValue={paymentMethod} className={input}>
          <option value="">{t('f.paymentMethod')}</option>
          {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{enumLabel(method, locale)}</option>)}
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
        <input name="dateFrom" type="date" defaultValue={dateFrom} className={input} aria-label={locale === 'ar' ? 'التاريخ من' : 'Date from'} />
        <input name="dateTo" type="date" defaultValue={dateTo} className={input} aria-label={locale === 'ar' ? 'التاريخ إلى' : 'Date to'} />
        <input name="minAmount" type="number" min="0" step="1" defaultValue={minAmount} placeholder={`${t('amount')} min`} className={input} />
        <input name="maxAmount" type="number" min="0" step="1" defaultValue={maxAmount} placeholder={`${t('amount')} max`} className={input} />
        <select name="sort" defaultValue={sort} className={input}>
          <option value="date_desc">{t('sortDateDesc')}</option>
          <option value="date_asc">{t('sortDateAsc')}</option>
          <option value="amount_desc">{t('sortAmountDesc')}</option>
          <option value="amount_asc">{t('sortAmountAsc')}</option>
          <option value="type">{t('sortType')}</option>
        </select>
        <div className="flex gap-2 md:col-span-4 xl:col-span-8">
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
        exportHref={canExport ? exportHref : undefined}
        exportLabel={tc('exportCsv')}
      />
    </>
  );
}
