import 'server-only';
import type { Currency, PartyType, Prisma } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { getExpenses } from '@/server/db/repositories/finance.repo';
import { getOrders, getOrderLines } from '@/server/db/repositories/sales.repo';
import { getUsdToIqd } from '@/server/settings';
import type { DashboardFilters } from '@/lib/filters';
import { convertToIqd } from '@/lib/money';
import type { ResolvedRange } from '@/lib/dates';
import * as M from '@/lib/metrics';
import { allocationTotal, classifyPurchase, type PurchaseAllocation } from '@/lib/metrics/purchases';

type Scope = { branchId?: string };
type LocalizedName = { en: string; ar: string };

function scopedBranchIds(filters: DashboardFilters, scope: Scope): string[] {
  if (scope.branchId) return [scope.branchId];
  return filters.branchId ?? [];
}

function branchEntryWhere(filters: DashboardFilters, scope: Scope): Prisma.FinanceEntryWhereInput {
  const ids = scopedBranchIds(filters, scope);
  if (!ids.length) return {};
  return ids.length === 1 ? { branchId: ids[0] } : { branchId: { in: ids } };
}

function branchEntityWhere(filters: DashboardFilters, scope: Scope): Prisma.BranchWhereInput {
  const ids = scopedBranchIds(filters, scope);
  if (!ids.length) return { isActive: true };
  return ids.length === 1 ? { id: ids[0] } : { id: { in: ids } };
}

function partyBranchWhere(filters: DashboardFilters, scope: Scope): Prisma.PartyWhereInput {
  const ids = scopedBranchIds(filters, scope);
  if (!ids.length) return {};
  const branchId = ids.length === 1 ? ids[0] : { in: ids };
  return {
    OR: [
      { branchId },
      { entries: { some: { branchId } } },
    ],
  };
}

function toIqd(amount: number, currency: Currency, rate: number): number {
  return convertToIqd(amount, currency, rate);
}

export interface PnlReport {
  grossRevenue: number;
  discounts: number;
  refunds: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  directDeliveryCost: number;
  operatingExpenses: number;
  operatingProfit: number;
}

export async function getPnlReport(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<PnlReport> {
  const [orders, lines, expenses] = await Promise.all([
    getOrders(filters, scope, range),
    getOrderLines(filters, scope, range),
    getExpenses(filters, scope, range),
  ]);
  return M.buildPnlSnapshot(orders, lines, expenses);
}

export type CashFlowBucketKey =
  | 'salesCollected'
  | 'receivablesCollected'
  | 'capitalContributions'
  | 'otherIncome'
  | 'supplierPayments'
  | 'expensesPaid'
  | 'inventoryPurchasesPaid'
  | 'fixedAssetPurchasesPaid'
  | 'ownerWithdrawals'
  | 'otherPayments'
  | 'transfersIn'
  | 'transfersOut';

export interface CashFlowBucket {
  key: CashFlowBucketKey;
  amount: number;
  count: number;
}

export interface CashFlowReport {
  cashIn: CashFlowBucket[];
  cashOut: CashFlowBucket[];
  totalIn: number;
  totalOut: number;
  netMovement: number;
}

function bucket(key: CashFlowBucketKey): CashFlowBucket {
  return { key, amount: 0, count: 0 };
}

function addBucket(rows: CashFlowBucket[], key: CashFlowBucketKey, amount: number): void {
  const row = rows.find((r) => r.key === key);
  if (!row) return;
  row.amount += amount;
  row.count += 1;
}

function addPurchaseCash(rows: CashFlowBucket[], paidAmount: number, allocation: PurchaseAllocation): void {
  const total = allocationTotal(allocation);
  if (total <= 0) {
    addBucket(rows, 'otherPayments', paidAmount);
    return;
  }
  const portions: [CashFlowBucketKey, number][] = [
    ['expensesPaid', allocation.operatingExpense],
    ['inventoryPurchasesPaid', allocation.inventory],
    ['fixedAssetPurchasesPaid', allocation.fixedAsset],
    ['otherPayments', allocation.unclassified],
  ];
  let assigned = 0;
  const populated = portions.filter(([, value]) => value > 0);
  populated.forEach(([key, value], index) => {
    const amount = index === populated.length - 1 ? paidAmount - assigned : Math.round(paidAmount * value / total);
    assigned += amount;
    addBucket(rows, key, amount);
  });
}

export async function getCashFlowReport(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
  options: { accountId?: string; partyId?: string } = {},
): Promise<CashFlowReport> {
  const and: Prisma.FinanceEntryWhereInput[] = [];
  if (options.accountId) and.push({ OR: [{ accountId: options.accountId }, { toAccountId: options.accountId }] });
  if (options.partyId) and.push({ partyId: options.partyId });

  const [entries, rate] = await Promise.all([
    prisma.financeEntry.findMany({
      where: {
        date: { gte: range.start, lte: range.end },
        obligation: false,
        archivedAt: null,
        reversedAt: null,
        reversalOfId: null,
        ...branchEntryWhere(filters, scope),
        ...(and.length ? { AND: and } : {}),
      },
      select: {
        type: true,
        amount: true,
        currency: true,
        accountId: true,
        toAccountId: true,
        settlesId: true,
        categoryType: true,
        ledgerLines: { select: { itemType: true, lineTotal: true, categoryType: true } },
        fixedAssets: { take: 1, select: { id: true } },
        costLayers: { take: 1, select: { id: true } },
        settles: {
          select: {
            type: true,
            amount: true,
            categoryType: true,
            ledgerLines: { select: { itemType: true, lineTotal: true, categoryType: true } },
            fixedAssets: { take: 1, select: { id: true } },
            costLayers: { take: 1, select: { id: true } },
          },
        },
      },
    }),
    getUsdToIqd(),
  ]);

  const cashIn = [
    bucket('salesCollected'),
    bucket('receivablesCollected'),
    bucket('capitalContributions'),
    bucket('otherIncome'),
    bucket('transfersIn'),
  ];
  const cashOut = [
    bucket('supplierPayments'),
    bucket('expensesPaid'),
    bucket('inventoryPurchasesPaid'),
    bucket('fixedAssetPurchasesPaid'),
    bucket('ownerWithdrawals'),
    bucket('otherPayments'),
    bucket('transfersOut'),
  ];

  for (const e of entries) {
    const amount = toIqd(e.amount, e.currency, rate);
    if (e.type === 'TRANSFER') {
      if (options.accountId && e.toAccountId === options.accountId) addBucket(cashIn, 'transfersIn', amount);
      if (options.accountId && e.accountId === options.accountId) addBucket(cashOut, 'transfersOut', amount);
      continue;
    }
    if (e.type === 'INCOME') addBucket(cashIn, 'salesCollected', amount);
    else if (e.type === 'PAYMENT_IN') addBucket(cashIn, e.settlesId ? 'receivablesCollected' : 'otherIncome', amount);
    else if (e.type === 'CAPITAL_IN') addBucket(cashIn, 'capitalContributions', amount);
    else if (e.type === 'EXPENSE') addBucket(cashOut, 'expensesPaid', amount);
    else if (e.type === 'PURCHASE') {
      addPurchaseCash(cashOut, amount, classifyPurchase({
        amount: e.amount,
        categoryType: e.categoryType,
        ledgerLines: e.ledgerLines,
        hasFixedAsset: e.fixedAssets.length > 0,
        hasInventoryLayer: e.costLayers.length > 0,
      }));
    } else if (e.type === 'PAYMENT_OUT' && e.settles?.type === 'PURCHASE') {
      addPurchaseCash(cashOut, amount, classifyPurchase({
        amount: e.settles.amount,
        categoryType: e.settles.categoryType,
        ledgerLines: e.settles.ledgerLines,
        hasFixedAsset: e.settles.fixedAssets.length > 0,
        hasInventoryLayer: e.settles.costLayers.length > 0,
      }));
    } else if (e.type === 'PAYMENT_OUT') addBucket(cashOut, e.settlesId ? 'supplierPayments' : 'otherPayments', amount);
    else if (e.type === 'DRAWING') addBucket(cashOut, 'ownerWithdrawals', amount);
  }

  const visibleIn = cashIn.filter((r) => r.amount !== 0 || r.count !== 0);
  const visibleOut = cashOut.filter((r) => r.amount !== 0 || r.count !== 0);
  const totalIn = visibleIn.reduce((sum, r) => sum + r.amount, 0);
  const totalOut = visibleOut.reduce((sum, r) => sum + r.amount, 0);
  return { cashIn: visibleIn, cashOut: visibleOut, totalIn, totalOut, netMovement: totalIn - totalOut };
}

export interface ProductProfitabilityRow {
  productId: string;
  sku: string;
  name: LocalizedName;
  groupName: LocalizedName;
  units: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
}

export interface ProductProfitabilityReport {
  rows: ProductProfitabilityRow[];
  totals: Omit<ProductProfitabilityRow, 'productId' | 'sku' | 'name' | 'groupName'>;
}

export async function getProductProfitabilityReport(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<ProductProfitabilityReport> {
  const lines = await getOrderLines(filters, scope, range);
  const rowsByProduct = new Map<string, ProductProfitabilityRow>();

  for (const line of lines) {
    const product = line.product;
    const row =
      rowsByProduct.get(line.productId) ??
      ({
        productId: line.productId,
        sku: line.sku,
        name: { en: product.nameEn, ar: product.nameAr },
        groupName: {
          en: product.group?.nameEn ?? product.nameEn,
          ar: product.group?.nameAr ?? product.nameAr,
        },
        units: 0,
        netSales: 0,
        cogs: 0,
        grossProfit: 0,
        grossMarginPct: 0,
      } satisfies ProductProfitabilityRow);
    row.units += line.quantity;
    row.netSales += line.lineNet;
    row.cogs += line.unitCogsSnapshot * line.quantity;
    rowsByProduct.set(line.productId, row);
  }

  const rows = [...rowsByProduct.values()].map((row) => {
    const grossProfit = row.netSales - row.cogs;
    return {
      ...row,
      grossProfit,
      grossMarginPct: row.netSales > 0 ? grossProfit / row.netSales : 0,
    };
  }).sort((a, b) => b.grossProfit - a.grossProfit);

  const totals = rows.reduce(
    (sum, row) => ({
      units: sum.units + row.units,
      netSales: sum.netSales + row.netSales,
      cogs: sum.cogs + row.cogs,
      grossProfit: sum.grossProfit + row.grossProfit,
      grossMarginPct: 0,
    }),
    { units: 0, netSales: 0, cogs: 0, grossProfit: 0, grossMarginPct: 0 },
  );
  totals.grossMarginPct = totals.netSales > 0 ? totals.grossProfit / totals.netSales : 0;
  return { rows, totals };
}

export interface BranchProfitabilityRow {
  branchId: string | null;
  branchName: LocalizedName;
  orders: number;
  grossRevenue: number;
  discounts: number;
  refunds: number;
  directDeliveryCost: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingProfit: number;
  operatingMarginPct: number;
}

function makeBranchRow(branchId: string | null, branchName: LocalizedName): BranchProfitabilityRow {
  return {
    branchId,
    branchName,
    orders: 0,
    grossRevenue: 0,
    discounts: 0,
    refunds: 0,
    directDeliveryCost: 0,
    netSales: 0,
    cogs: 0,
    grossProfit: 0,
    operatingExpenses: 0,
    operatingProfit: 0,
    operatingMarginPct: 0,
  };
}

export async function getBranchProfitabilityReport(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<BranchProfitabilityRow[]> {
  const [branches, orders, lines, expenses, rate] = await Promise.all([
    prisma.branch.findMany({ where: branchEntityWhere(filters, scope), select: { id: true, nameEn: true, nameAr: true } }),
    getOrders(filters, scope, range),
    getOrderLines(filters, scope, range),
    getExpenses(filters, scope, range),
    getUsdToIqd(),
  ]);

  const rows = new Map<string, BranchProfitabilityRow>();
  for (const b of branches) rows.set(b.id, makeBranchRow(b.id, { en: b.nameEn, ar: b.nameAr }));

  const ensureRow = (branchId: string | null): BranchProfitabilityRow => {
    const key = branchId ?? 'unassigned';
    const existing = rows.get(key);
    if (existing) return existing;
    const row = makeBranchRow(branchId, { en: 'Unassigned', ar: 'غير مخصص' });
    rows.set(key, row);
    return row;
  };

  for (const order of orders) {
    if (!M.isSalesOrder(order)) continue;
    const row = ensureRow(order.branchId ?? null);
    row.orders += 1;
    row.grossRevenue += order.grossAmount;
    row.discounts += order.discountAmount;
    row.refunds += order.refundAmount;
    row.directDeliveryCost += order.deliveryCost;
    row.netSales += order.grossAmount - order.discountAmount - order.refundAmount;
  }

  for (const line of lines) {
    ensureRow(line.branchId ?? null).cogs += line.unitCogsSnapshot * line.quantity;
  }

  for (const expense of expenses) {
    ensureRow(expense.branchId ?? null).operatingExpenses += toIqd(expense.amount, expense.currency, rate);
  }

  return [...rows.values()]
    .map((row) => {
      const grossProfit = row.netSales - row.cogs;
      const operatingProfit = grossProfit - row.directDeliveryCost - row.operatingExpenses;
      return {
        ...row,
        grossProfit,
        operatingProfit,
        operatingMarginPct: row.netSales > 0 ? operatingProfit / row.netSales : 0,
      };
    })
    .filter((row) => row.orders > 0 || row.netSales !== 0 || row.cogs !== 0 || row.operatingExpenses !== 0)
    .sort((a, b) => b.operatingProfit - a.operatingProfit);
}

export interface PartyStatementRow {
  partyId: string;
  partyName: string;
  partyType: PartyType;
  opening: number;
  charges: number;
  payments: number;
  closing: number;
  lastActivity: Date | null;
}

export interface PartyStatementsReport {
  customers: PartyStatementRow[];
  suppliers: PartyStatementRow[];
  customerClosingTotal: number;
  supplierClosingTotal: number;
}

function statementEffect(
  partyType: 'CUSTOMER' | 'SUPPLIER',
  entry: {
    type: string;
    amount: number;
    currency: Currency;
    obligation: boolean;
    obligationKind: string | null;
  },
  rate: number,
): { charge: number; payment: number } {
  const amount = toIqd(entry.amount, entry.currency, rate);
  if (partyType === 'CUSTOMER') {
    if (entry.obligation && entry.obligationKind === 'RECEIVABLE') return { charge: amount, payment: 0 };
    if (entry.type === 'PAYMENT_IN') return { charge: 0, payment: amount };
  } else {
    if (entry.obligation && entry.obligationKind === 'PAYABLE') return { charge: amount, payment: 0 };
    if (entry.type === 'PAYMENT_OUT') return { charge: 0, payment: amount };
  }
  return { charge: 0, payment: 0 };
}

export async function getPartyStatementsReport(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<PartyStatementsReport> {
  const [parties, rate] = await Promise.all([
    prisma.party.findMany({
      where: {
        type: { in: ['CUSTOMER', 'SUPPLIER'] },
        ...partyBranchWhere(filters, scope),
      },
      select: {
        id: true,
        name: true,
        type: true,
        openingPayable: true,
        openingReceivable: true,
        entries: {
          where: {
            date: { lte: range.end },
            archivedAt: null,
            reversedAt: null,
            reversalOfId: null,
            ...branchEntryWhere(filters, scope),
          },
          select: {
            date: true,
            type: true,
            amount: true,
            currency: true,
            obligation: true,
            obligationKind: true,
          },
          orderBy: { date: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    }),
    getUsdToIqd(),
  ]);

  const rows = parties.map((party): PartyStatementRow => {
    const isCustomer = party.type === 'CUSTOMER';
    let opening = isCustomer
      ? party.openingReceivable - party.openingPayable
      : party.openingPayable - party.openingReceivable;
    let charges = 0;
    let payments = 0;
    let lastActivity: Date | null = null;

    for (const entry of party.entries) {
      const effect = statementEffect(isCustomer ? 'CUSTOMER' : 'SUPPLIER', entry, rate);
      const net = effect.charge - effect.payment;
      if (entry.date < range.start) opening += net;
      else {
        charges += effect.charge;
        payments += effect.payment;
      }
      if (effect.charge !== 0 || effect.payment !== 0) lastActivity = entry.date;
    }

    return {
      partyId: party.id,
      partyName: party.name,
      partyType: party.type,
      opening,
      charges,
      payments,
      closing: opening + charges - payments,
      lastActivity,
    };
  });

  const activeRows = rows.filter((row) => row.opening !== 0 || row.charges !== 0 || row.payments !== 0 || row.closing !== 0);
  const customers = activeRows.filter((row) => row.partyType === 'CUSTOMER').sort((a, b) => b.closing - a.closing);
  const suppliers = activeRows.filter((row) => row.partyType === 'SUPPLIER').sort((a, b) => b.closing - a.closing);

  return {
    customers,
    suppliers,
    customerClosingTotal: customers.reduce((sum, row) => sum + row.closing, 0),
    supplierClosingTotal: suppliers.reduce((sum, row) => sum + row.closing, 0),
  };
}
