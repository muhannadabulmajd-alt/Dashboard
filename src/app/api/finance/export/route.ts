import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { prisma } from '@/server/db/client';
import { toCsv } from '@/server/export/csv';
import { parseFilters } from '@/lib/filters';
import { enumLabel, FINANCE_TYPES } from '@/lib/enums';
import { formatDate } from '@/lib/dates';
import { ledgerRecordClassLabel } from '@/lib/ledger-record-class';
import { convertToIqd, toMajor, type AppLocale } from '@/lib/money';
import { signedEffect } from '@/lib/metrics/finance';
import { buildBranchScope, rangeFor } from '@/server/filters/where-builder';
import {
  getBranchProfitabilityReport,
  getCashFlowReport,
  getPartyStatementsReport,
  getPnlReport,
  getProductProfitabilityReport,
  type CashFlowBucketKey,
} from '@/server/finance/reports';
import { getSpendRows, getSpendTotals, type SpendBucket } from '@/server/finance/spend';
import { getBalanceSheetSnapshot } from '@/server/finance/balance-sheet';
import { getUsdToIqd } from '@/server/settings';
import type { ObligationKind, FinanceType, LedgerRecordClass, Prisma } from '@prisma/client';

const CASH_FLOW_LABELS: Record<CashFlowBucketKey, string> = {
  salesCollected: 'Sales collected',
  receivablesCollected: 'Receivables collected',
  capitalContributions: 'Capital contributions',
  otherIncome: 'Other income',
  supplierPayments: 'Supplier payments',
  expensesPaid: 'Expenses paid',
  inventoryPurchasesPaid: 'Inventory purchases paid',
  fixedAssetPurchasesPaid: 'Equipment and assets paid',
  ownerWithdrawals: 'Owner withdrawals',
  otherPayments: 'Other payments',
  transfersIn: 'Transfers in',
  transfersOut: 'Transfers out',
};

function ledgerWhere(p: URLSearchParams): Prisma.FinanceEntryWhereInput {
  const q = (p.get('q') ?? '').trim();
  const type = p.get('type') ?? '';
  const recordClass = p.get('recordClass') ?? '';
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
  if (['PURCHASE', 'EXPENSE', 'MIXED'].includes(recordClass)) and.push({ recordClass: recordClass as LedgerRecordClass });
  if (accountId) and.push({ OR: [{ accountId }, { toAccountId: accountId }] });
  if (partyId) and.push({ partyId });
  if (branchId) and.push({ branchId });
  if (status === 'paid') and.push({ obligation: false, reversedAt: null, reversalOfId: null });
  if (status === 'due') and.push({ obligation: true, reversedAt: null, reversalOfId: null });
  if (status === 'reversed') and.push({ reversedAt: { not: null } });
  if (status === 'reversal') and.push({ reversalOfId: { not: null } });
  if (status === 'archived') and.push({ archivedAt: { not: null } });
  else and.push({ archivedAt: null });
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
  if (!can(user.role, 'export:financial')) return new NextResponse('Forbidden', { status: 403 });

  const p = req.nextUrl.searchParams;
  const type = p.get('type') ?? 'ledger';
  const locale = (p.get('locale') ?? 'en') as AppLocale;
  const filters = parseFilters(Object.fromEntries(p.entries()));
  const scope = buildBranchScope(user);
  const range = rangeFor(filters);

  let headers: string[];
  let rows: (string | number)[][];
  let filename: string;

  if (type === 'dues') {
    const kind = p.get('kind') as ObligationKind | null;
    const branchWhere = scope.branchId
      ? { branchId: scope.branchId }
      : filters.branchId?.length
        ? { branchId: { in: filters.branchId } }
        : {};
    const [obligations, rate] = await Promise.all([prisma.financeEntry.findMany({
      where: { obligation: true, date: { lte: range.end }, archivedAt: null, reversedAt: null, reversalOfId: null, ...branchWhere, ...(kind ? { obligationKind: kind } : {}) },
      include: { party: { select: { name: true } }, settlements: { where: { archivedAt: null, reversedAt: null, reversalOfId: null }, select: { amount: true, currency: true } } },
      orderBy: { dueDate: 'asc' },
    }), getUsdToIqd()]);
    headers = ['Kind', 'Party', 'Description', 'Amount', 'Paid', 'Outstanding', 'Currency', 'DueDate'];
    rows = obligations
      .map((o) => {
        const amount = convertToIqd(o.amount, o.currency, rate);
        const paid = o.settlements.reduce((s, x) => s + convertToIqd(x.amount, x.currency, rate), 0);
        const out = Math.max(0, amount - paid);
        return [
          o.obligationKind ? enumLabel(o.obligationKind, locale) : '',
          o.party?.name ?? '',
          o.description ?? '',
          toMajor(amount, 'IQD'),
          toMajor(paid, 'IQD'),
          toMajor(out, 'IQD'),
          'IQD',
          o.dueDate ? formatDate(o.dueDate, locale) : '',
        ];
      })
      .filter((r) => Number(r[5]) > 0);
    filename = 'dues';
  } else if (type === 'balances') {
    const snapshot = await getBalanceSheetSnapshot({ filters, scope, asOf: range.end });
    headers = ['Section', 'Name', 'Currency', 'Amount'];
    rows = [];
    for (const row of snapshot.currencies) {
      for (const account of row.accounts) rows.push(['Account', account.name, row.currency, toMajor(account.balance, row.currency)]);
      if (row.unassignedCash) rows.push(['Account', 'Unassigned', row.currency, toMajor(row.unassignedCash, row.currency)]);
      rows.push(['Assets', 'Cash & bank', row.currency, toMajor(row.cashBank, row.currency)]);
      rows.push(['Assets', 'Receivables', row.currency, toMajor(row.receivables, row.currency)]);
      if (row.currency === 'IQD') {
        rows.push(['Assets', 'Inventory', row.currency, toMajor(row.inventory, row.currency)]);
        rows.push(['Assets', 'Fixed assets', row.currency, toMajor(row.fixedAssets, row.currency)]);
      }
      rows.push(['Assets', 'Total assets', row.currency, toMajor(row.totalAssets, row.currency)]);
      rows.push(['Liabilities', 'Payables', row.currency, toMajor(row.payables, row.currency)]);
      rows.push(['Equity', 'Capital', row.currency, toMajor(row.capital, row.currency)]);
      rows.push(['Equity', 'Retained', row.currency, toMajor(row.retained, row.currency)]);
      rows.push(['Equity', 'Total equity', row.currency, toMajor(row.totalEquity, row.currency)]);
    }
    filename = 'balance-sheet';
  } else if (type === 'pnl') {
    const [report, spend] = await Promise.all([
      getPnlReport(filters, scope, range),
      getSpendTotals(filters, scope, range),
    ]);
    headers = ['Line', 'Amount_IQD'];
    rows = [
      ['Gross revenue', report.grossRevenue],
      ['Discounts', -report.discounts],
      ['Refunds', -report.refunds],
      ['Sales earned', report.netSales],
      ['Total business spending', -spend.totalSpent],
      ['COGS', -report.cogs],
      ['Gross profit', report.grossProfit],
      ['Gross margin %', (report.grossMarginPct * 100).toFixed(1)],
      ['Direct delivery costs', -report.directDeliveryCost],
      ['Payment processing fees', -report.paymentProcessingCosts],
      ['Contribution profit', report.contributionProfit],
      ['Operating expenses', -report.operatingExpenses],
      ['Operating profit', report.operatingProfit],
      ['Capital spending', -spend.capex],
      ['Inventory purchases', -spend.inventory],
    ];
    filename = 'pnl';
  } else if (type === 'cash-flow') {
    const report = await getCashFlowReport(filters, scope, range, {
      accountId: p.get('accountId') ?? undefined,
      partyId: p.get('partyId') ?? undefined,
    });
    headers = ['Section', 'Category', 'Count', 'Amount_IQD'];
    rows = [
      ...report.cashIn.map((row) => ['Cash in', CASH_FLOW_LABELS[row.key], row.count, row.amount]),
      ...report.cashOut.map((row) => ['Cash out', CASH_FLOW_LABELS[row.key], row.count, row.amount]),
      ['Net', 'Net cash movement', '', report.netMovement],
    ];
    filename = 'cash-flow-summary';
  } else if (type === 'product-profitability') {
    const report = await getProductProfitabilityReport(filters, scope, range);
    headers = ['SKU', 'Product', 'Group', 'Units', 'NetSales_IQD', 'COGS_IQD', 'GrossProfit_IQD', 'GrossMargin_%'];
    rows = report.rows.map((row) => [
      row.sku,
      row.name[locale],
      row.groupName[locale],
      row.units,
      row.netSales,
      row.cogs,
      row.grossProfit,
      (row.grossMarginPct * 100).toFixed(1),
    ]);
    filename = 'product-profitability';
  } else if (type === 'branch-profitability') {
    const report = await getBranchProfitabilityReport(filters, scope, range);
    headers = ['Branch', 'Orders', 'GrossRevenue_IQD', 'Discounts_IQD', 'Refunds_IQD', 'NetSales_IQD', 'COGS_IQD', 'GrossProfit_IQD', 'OperatingExpenses_IQD', 'OperatingProfit_IQD', 'OperatingMargin_%'];
    rows = report.map((row) => [
      row.branchName[locale],
      row.orders,
      row.grossRevenue,
      row.discounts,
      row.refunds,
      row.netSales,
      row.cogs,
      row.grossProfit,
      row.operatingExpenses,
      row.operatingProfit,
      (row.operatingMarginPct * 100).toFixed(1),
    ]);
    filename = 'branch-profitability';
  } else if (type === 'statements') {
    const report = await getPartyStatementsReport(filters, scope, range);
    const kind = p.get('kind');
    const statementRows =
      kind === 'customer' ? report.customers : kind === 'supplier' ? report.suppliers : [...report.customers, ...report.suppliers];
    headers = ['Kind', 'Party', 'Opening_IQD', 'Charges_IQD', 'Payments_IQD', 'Closing_IQD', 'LastActivity'];
    rows = statementRows.map((row) => [
      row.partyType,
      row.partyName,
      row.opening,
      row.charges,
      row.payments,
      row.closing,
      row.lastActivity ? formatDate(row.lastActivity, locale) : '',
    ]);
    filename = kind === 'customer' ? 'customer-statements' : kind === 'supplier' ? 'supplier-statements' : 'party-statements';
  } else if (type === 'spend') {
    const bucket = (
      ['all', 'capex', 'inventory', 'opex', 'direct', 'cogs'].includes(p.get('bucket') ?? '')
        ? p.get('bucket')
        : 'all'
    ) as SpendBucket;
    const spendRows = await getSpendRows(bucket, filters, scope, range, {
      category: p.get('category') ?? undefined,
      month: p.get('month') ?? undefined,
      party: p.get('party') ?? undefined,
      q: p.get('q') ?? undefined,
    });
    headers = ['Bucket', 'Date', 'Description', 'Category', 'Party', 'Reference', 'Amount_IQD'];
    rows = spendRows.map((row) => [
      row.bucket,
      formatDate(row.date, locale),
      row.description,
      row.category,
      row.party ?? '',
      row.reference ?? '',
      row.amount,
    ]);
    filename = `${bucket}-details`;
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
      'Transaction ID', 'Date', 'Type', 'Record class', 'Money in', 'Money out', 'Currency',
      'Account', 'Party', 'Category', 'Branch', 'Related', 'Created by',
      'Status', 'Attachment', 'Reference', 'Description',
    ];
    rows = entries.map((e) => [
      e.id,
      formatDate(e.date, locale),
      enumLabel(e.type, locale),
      e.recordClass ? ledgerRecordClassLabel(e.recordClass, locale) : '',
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
