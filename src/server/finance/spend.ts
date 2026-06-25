import 'server-only';
import { prisma } from '@/server/db/client';
import { monthBucketKey } from '@/lib/dates';
import { convertToIqd } from '@/lib/money';
import { buildExpenseWhere, buildOrderLineWhere } from '@/server/filters/where-builder';
import { getOrderStatusRoleMap } from '@/server/lists/resolver';
import { getUsdToIqd } from '@/server/settings';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';
import type { Currency } from '@prisma/client';

export type SpendBucket = 'capex' | 'opex' | 'cogs';

export interface SpendRow {
  id: string;
  bucket: SpendBucket;
  date: Date;
  month: string;
  description: string;
  category: string;
  party: string | null;
  reference: string | null;
  amount: number;
  sourceHref: string | null;
}

export interface SpendFilters {
  category?: string;
  month?: string;
  party?: string;
  q?: string;
}

type Scope = { branchId?: string };

function branchWhere(filters: DashboardFilters, scope: Scope) {
  return scope.branchId
    ? { branchId: scope.branchId }
    : filters.branchId?.length
      ? { branchId: { in: filters.branchId } }
      : {};
}

function matches(row: SpendRow, filters: SpendFilters): boolean {
  if (filters.category && row.category !== filters.category) return false;
  if (filters.month && row.month !== filters.month) return false;
  if (filters.party && row.party !== filters.party) return false;
  if (filters.q) {
    const haystack = [row.description, row.category, row.party, row.reference].filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(filters.q.toLowerCase())) return false;
  }
  return true;
}

export async function getSpendRows(
  bucket: SpendBucket,
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
  rowFilters: SpendFilters = {},
): Promise<SpendRow[]> {
  const rate = await getUsdToIqd();
  const branch = branchWhere(filters, scope);

  if (bucket === 'cogs') {
    const roles = await getOrderStatusRoleMap();
    const saleStatuses = [...roles].filter(([, role]) => role === 'SALE').map(([code]) => code);
    const lines = await prisma.orderLine.findMany({
      where: buildOrderLineWhere(filters, scope, range, saleStatuses),
      select: {
        id: true,
        sku: true,
        quantity: true,
        unitCogsSnapshot: true,
        product: { select: { nameEn: true, nameAr: true, sku: true } },
        order: { select: { id: true, orderNumber: true, placedAt: true, customer: { select: { nameEn: true, nameAr: true } } } },
      },
      orderBy: { order: { placedAt: 'desc' } },
    });
    return lines
      .map((line): SpendRow => {
        const date = line.order.placedAt;
        const label = line.product.nameEn || line.product.nameAr || line.sku;
        return {
          id: line.id,
          bucket,
          date,
          month: monthBucketKey(date),
          description: `${label} x ${line.quantity}`,
          category: line.sku,
          party: line.order.customer?.nameEn || line.order.customer?.nameAr || null,
          reference: line.order.orderNumber,
          amount: line.unitCogsSnapshot * line.quantity,
          sourceHref: `/admin/records/orders/${line.order.id}`,
        };
      })
      .filter((row) => matches(row, rowFilters));
  }

  const financeRows = await prisma.financeEntry.findMany({
    where: {
      type: { in: ['EXPENSE', 'PURCHASE'] },
      date: { gte: range.start, lte: range.end },
      archivedAt: null,
      reversedAt: null,
      reversalOfId: null,
      ...branch,
    },
    select: {
      id: true,
      date: true,
      amount: true,
      currency: true,
      description: true,
      reference: true,
      categoryType: true,
      party: { select: { name: true } },
      ledgerLines: {
        select: {
          id: true,
          itemType: true,
          itemName: true,
          categoryType: true,
          lineTotal: true,
          notes: true,
        },
        orderBy: { lineNo: 'asc' },
      },
      fixedAssets: { select: { id: true } },
      costLayers: { select: { id: true } },
    },
    orderBy: { date: 'desc' },
  });

  const rows: SpendRow[] = [];
  for (const entry of financeRows) {
    if (entry.ledgerLines.length) {
      for (const line of entry.ledgerLines) {
        const itemType = line.itemType.toUpperCase();
        const rowBucket: SpendBucket | null =
          itemType === 'ASSET'
            ? 'capex'
            : itemType === 'INVENTORY'
              ? null
              : 'opex';
        if (rowBucket !== bucket) continue;
        rows.push({
          id: line.id,
          bucket: rowBucket,
          date: entry.date,
          month: monthBucketKey(entry.date),
          description: line.itemName || entry.description || entry.reference || entry.id,
          category: line.categoryType ?? entry.categoryType ?? 'OVERHEAD',
          party: entry.party?.name ?? null,
          reference: entry.reference,
          amount: convertToIqd(line.lineTotal, entry.currency, rate),
          sourceHref: `/finance/ledger/${entry.id}`,
        });
      }
      continue;
    }

    if (bucket === 'capex' && entry.fixedAssets.length) {
      rows.push({
        id: entry.id,
        bucket,
        date: entry.date,
        month: monthBucketKey(entry.date),
        description: entry.description ?? entry.reference ?? entry.id,
        category: entry.categoryType ?? 'EQUIPMENT',
        party: entry.party?.name ?? null,
        reference: entry.reference,
        amount: convertToIqd(entry.amount, entry.currency, rate),
        sourceHref: `/finance/ledger/${entry.id}`,
      });
    }
    if (bucket === 'opex' && !entry.fixedAssets.length && !entry.costLayers.length) {
      rows.push({
        id: entry.id,
        bucket,
        date: entry.date,
        month: monthBucketKey(entry.date),
        description: entry.description ?? entry.reference ?? entry.id,
        category: entry.categoryType ?? 'OVERHEAD',
        party: entry.party?.name ?? null,
        reference: entry.reference,
        amount: convertToIqd(entry.amount, entry.currency, rate),
        sourceHref: `/finance/ledger/${entry.id}`,
      });
    }
  }

  if (bucket === 'opex') {
    const expenses = await prisma.expense.findMany({
      where: buildExpenseWhere(filters, scope, range),
      select: {
        id: true,
        incurredAt: true,
        amount: true,
        currency: true,
        vendor: true,
        note: true,
        category: { select: { type: true, nameEn: true, nameAr: true } },
      },
      orderBy: { incurredAt: 'desc' },
    });
    rows.push(
      ...expenses.map((expense): SpendRow => ({
        id: expense.id,
        bucket,
        date: expense.incurredAt,
        month: monthBucketKey(expense.incurredAt),
        description: expense.note ?? expense.category.nameEn ?? expense.category.nameAr,
        category: expense.category.type,
        party: expense.vendor,
        reference: null,
        amount: convertToIqd(expense.amount, expense.currency as Currency, rate),
        sourceHref: null,
      })),
    );
  }

  return rows.filter((row) => matches(row, rowFilters)).sort((a, b) => b.date.getTime() - a.date.getTime());
}

export async function getSpendTotals(filters: DashboardFilters, scope: Scope, range: ResolvedRange) {
  const [capex, opex, cogs] = await Promise.all([
    getSpendRows('capex', filters, scope, range),
    getSpendRows('opex', filters, scope, range),
    getSpendRows('cogs', filters, scope, range),
  ]);
  return {
    capex: capex.reduce((sum, row) => sum + row.amount, 0),
    opex: opex.reduce((sum, row) => sum + row.amount, 0),
    cogs: cogs.reduce((sum, row) => sum + row.amount, 0),
  };
}

export function spendByMonth(rows: SpendRow[]) {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.month, (map.get(row.month) ?? 0) + row.amount);
  return [...map.entries()].map(([key, amount]) => ({ key, amount })).sort((a, b) => a.key.localeCompare(b.key));
}

export function spendByCategory(rows: SpendRow[]) {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.category, (map.get(row.category) ?? 0) + row.amount);
  return [...map.entries()].map(([key, amount]) => ({ key, amount })).sort((a, b) => b.amount - a.amount);
}

export function spendByParty(rows: SpendRow[]) {
  const map = new Map<string, number>();
  for (const row of rows) if (row.party) map.set(row.party, (map.get(row.party) ?? 0) + row.amount);
  return [...map.entries()].map(([key, amount]) => ({ key, amount })).sort((a, b) => b.amount - a.amount);
}
