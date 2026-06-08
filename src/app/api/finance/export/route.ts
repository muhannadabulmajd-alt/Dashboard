import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { prisma } from '@/server/db/client';
import { toCsv } from '@/server/export/csv';
import { enumLabel } from '@/lib/enums';
import { formatDate } from '@/lib/dates';
import { toMajor, type AppLocale } from '@/lib/money';
import { accountBalance, financeTotals, type FinanceEntryLike } from '@/lib/metrics/finance';
import type { ObligationKind, Currency } from '@prisma/client';

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
      where: { obligation: true, ...(kind ? { obligationKind: kind } : {}) },
      include: { party: { select: { name: true } }, settlements: { select: { amount: true } } },
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
      const tot = financeTotals(ce);
      const cashBank = ca.reduce((s, a) => s + accountBalance(a, ce), 0);
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
    const entries = await prisma.financeEntry.findMany({
      orderBy: { date: 'desc' },
      include: { party: { select: { name: true } }, account: { select: { name: true } } },
    });
    headers = ['Date', 'Type', 'Status', 'Amount', 'Currency', 'Account', 'Party', 'Category', 'Reference', 'Description'];
    rows = entries.map((e) => [
      formatDate(e.date, locale),
      enumLabel(e.type, locale),
      e.obligation ? 'Due' : 'Paid',
      toMajor(e.amount, e.currency),
      e.currency,
      e.account?.name ?? '',
      e.party?.name ?? '',
      e.categoryType ? enumLabel(e.categoryType, locale) : '',
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
