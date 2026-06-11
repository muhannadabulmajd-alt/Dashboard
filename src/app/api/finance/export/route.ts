import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { prisma } from '@/server/db/client';
import { toCsv } from '@/server/export/csv';
import { enumLabel, FINANCE_TYPES } from '@/lib/enums';
import { formatDate } from '@/lib/dates';
import { toMajor, type AppLocale } from '@/lib/money';
import { accountBalance, netCash, unassignedCash, financeTotals, signedEffect, type FinanceEntryLike } from '@/lib/metrics/finance';
import type { ObligationKind, Currency, FinanceType, Prisma } from '@prisma/client';

function ledgerWhere(p: URLSearchParams): Prisma.FinanceEntryWhereInput {
  const q = (p.get('q') ?? '').trim();
  const type = p.get('type') ?? '';
  const status = p.get('status') ?? '';
  const accountId = p.get('accountId') ?? '';
  const partyId = p.get('partyId') ?? '';
  const branchId = p.get('branchId') ?? '';
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
  return and.length ? { AND: and } : {};
}

function ledgerOrderBy(p: URLSearchParams): Prisma.FinanceEntryOrderByWithRelationInput {
  const sort = p.get('sort') ?? 'date_desc';
  if (sort === 'date_asc') return { date: 'asc' };
  if (sort === 'amount_desc') return { amount: 'desc' };
  if (sort === 'amount_asc') return { amount: 'asc' };
  if (sort === 'type') return { type: 'asc' };
  return { date: 'desc' };
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  if (!can(user.role, 'view:finance')) return new NextResponse('Forbidden', { status: 403 });

  const p = req.nextUrl.searchParams;
  const type = p.get('type') ?? 'ledger';
  const locale = (p.get('locale') ?? 'en') as AppLocale;

  let headers: string[];
  let rows: (string | number)[][];
  let filename: string;

  if (type === 'dues') {
    const kind = p.get('kind') as ObligationKind | null;
    const obligations = await prisma.financeEntry.findMany({
      where: { obligation: true, reversedAt: null, reversalOfId: null, ...(kind ? { obligationKind: kind } : {}) },
      include: { party: { select: { name: true } }, settlements: { where: { reversedAt: null, reversalOfId: null }, select: { amount: true } } },
      orderBy: { dueDate: 'asc' },
    });
    headers = ['Kind', 'Party', 'Description', 'Amount', 'Paid', 'Outstanding', 'Currency', 'DueDate'];
    rows = obligations
      .map((o) => {
        const paid = o.settlements.reduce((s, x) => s + x.amount, 0);
        const out = Math.max(0, o.amount - paid);
        return [
          o.obligationKind ? enumLabel(o.obligationKind, locale) : '',
          o.party?.name ?? '',
          o.description ?? '',
          toMajor(o.amount, o.currency),
          toMajor(paid, o.currency),
          toMajor(out, o.currency),
          o.currency,
          o.dueDate ? formatDate(o.dueDate, locale) : '',
        ];
      })
      .filter((r) => Number(r[5]) > 0);
    filename = 'dues';
  } else if (type === 'balances') {
    const [accounts, entriesRaw] = await Promise.all([
      prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      prisma.financeEntry.findMany({
        select: {
          id: true, type: true, amount: true, currency: true, obligation: true,
          obligationKind: true, accountId: true, toAccountId: true, settlesId: true,
          reversedAt: true, reversalOfId: true,
        },
      }),
    ]);
    const entries = entriesRaw as FinanceEntryLike[];
    headers = ['Section', 'Name', 'Currency', 'Amount'];
    rows = [];
    const currencies = Array.from(new Set([...accounts.map((a) => a.currency), ...entries.map((e) => e.currency)]));
    for (const cur of (currencies.length ? currencies : ['IQD']) as Currency[]) {
      const ce = entries.filter((e) => e.currency === cur);
      const ca = accounts.filter((a) => a.currency === cur);
      for (const a of ca) rows.push(['Account', a.name, cur, toMajor(accountBalance(a, ce), cur)]);
      const unassigned = unassignedCash(ce);
      if (unassigned) rows.push(['Account', 'Unassigned', cur, toMajor(unassigned, cur)]);
      const tot = financeTotals(ce);
      const cashBank = netCash(ca, ce);
      const totalAssets = cashBank + tot.outstandingReceivable;
      const retained = totalAssets - tot.outstandingPayable - tot.capitalIn;
      rows.push(['Assets', 'Cash & bank', cur, toMajor(cashBank, cur)]);
      rows.push(['Assets', 'Receivables', cur, toMajor(tot.outstandingReceivable, cur)]);
      rows.push(['Assets', 'Total assets', cur, toMajor(totalAssets, cur)]);
      rows.push(['Liabilities', 'Payables', cur, toMajor(tot.outstandingPayable, cur)]);
      rows.push(['Equity', 'Capital', cur, toMajor(tot.capitalIn, cur)]);
      rows.push(['Equity', 'Retained', cur, toMajor(retained, cur)]);
    }
    filename = 'balance-sheet';
  } else {
    const [entries, branches, users] = await Promise.all([
      prisma.financeEntry.findMany({
        where: ledgerWhere(p),
        orderBy: ledgerOrderBy(p),
        include: {
          party: { select: { name: true } },
          account: { select: { name: true } },
          toAccount: { select: { name: true } },
        },
      }),
      prisma.branch.findMany({ select: { id: true, nameEn: true, nameAr: true } }),
      prisma.user.findMany({ select: { id: true, name: true, email: true } }),
    ]);
    const branchName = new Map(branches.map((b) => [b.id, locale === 'ar' ? b.nameAr : b.nameEn]));
    const userName = new Map(users.map((u) => [u.id, u.name || u.email]));
    headers = [
      'Transaction ID', 'Date', 'Type', 'Money in', 'Money out', 'Currency',
      'Account', 'Party', 'Category', 'Branch', 'Related', 'Created by',
      'Status', 'Attachment', 'Reference', 'Description',
    ];
    rows = entries.map((e) => [
      e.id,
      formatDate(e.date, locale),
      enumLabel(e.type, locale),
      !e.reversedAt && !e.reversalOfId && !e.obligation && (signedEffect(e) > 0 || e.type === 'TRANSFER') ? toMajor(e.amount, e.currency) : '',
      !e.reversedAt && !e.reversalOfId && !e.obligation && (signedEffect(e) < 0 || e.type === 'TRANSFER') ? toMajor(e.amount, e.currency) : '',
      e.currency,
      e.type === 'TRANSFER' ? `${e.account?.name ?? ''} -> ${e.toAccount?.name ?? ''}` : e.account?.name ?? '',
      e.party?.name ?? '',
      e.categoryType ? enumLabel(e.categoryType, locale) : '',
      e.branchId ? branchName.get(e.branchId) ?? '' : '',
      e.orderId ?? e.importKey ?? e.reference ?? '',
      e.createdById ? userName.get(e.createdById) ?? e.createdById : '',
      e.reversalOfId ? 'Reversal marker' : e.reversedAt ? 'Reversed' : e.obligation ? 'Due' : 'Paid',
      e.attachmentUrl ?? '',
      e.reference ?? '',
      e.description ?? '',
    ]);
    filename = 'ledger';
  }

  await prisma.auditLog.create({
    data: { userId: user.id, action: 'EXPORT', entity: 'finance', metadata: { type } },
  });
  return new NextResponse(toCsv(headers, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="laheeb-${filename}.csv"`,
    },
  });
}
