import 'server-only';
import { prisma } from '@/server/db/client';
import { monthBucketKey } from '@/lib/dates';
import { convertToIqd } from '@/lib/money';
import { buildOrderLineWhere } from '@/server/filters/where-builder';
import { getOrderStatusRoleMap } from '@/server/lists/resolver';
import { getUsdToIqd } from '@/server/settings';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';

export type SpendBucket =
  | 'all'
  | 'capex'
  | 'inventory'
  | 'operating'
  | 'overhead'
  | 'opex'
  | 'review'
  | 'direct'
  | 'cogs'
  | 'promotion';
type ClassifiedSpendBucket = Exclude<SpendBucket, 'all' | 'operating' | 'overhead'>;

export interface SpendRow {
  id: string;
  bucket: ClassifiedSpendBucket;
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

export interface SpendFacts {
  capex: number;
  inventory: number;
  opex: number;
  review: number;
  operating: number;
  direct: number;
  cogs: number;
  totalSpent: number;
}

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
  if (bucket === 'all') {
    const groups = await Promise.all(
      (['capex', 'inventory', 'operating'] as const).map((group) =>
        getSpendRows(group, filters, scope, range, rowFilters),
      ),
    );
    return groups.flat().sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  if (bucket === 'operating') {
    const groups = await Promise.all(
      (['opex', 'review'] as const).map((group) =>
        getSpendRows(group, filters, scope, range, rowFilters),
      ),
    );
    return groups.flat().sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  const rate = await getUsdToIqd();
  const branch = branchWhere(filters, scope);

  if (bucket === 'cogs' || bucket === 'promotion') {
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
        order: {
          select: {
            id: true,
            orderNumber: true,
            placedAt: true,
            purpose: true,
            customer: { select: { nameEn: true, nameAr: true } },
          },
        },
      },
      orderBy: { order: { placedAt: 'desc' } },
    });
    const purpose = bucket === 'promotion' ? 'PROMOTION' : 'SALE';
    return lines
      .filter((line) => line.order.purpose === purpose)
      .map((line): SpendRow => {
        const date = line.order.placedAt;
        const label = line.product.nameEn || line.product.nameAr || line.sku;
        return {
          id: line.id,
          bucket,
          date,
          month: monthBucketKey(date),
          description:
            bucket === 'promotion'
              ? `${label} x ${line.quantity} · promotion`
              : `${label} x ${line.quantity}`,
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
      costRole: true,
      party: { select: { name: true } },
      ledgerLines: {
        select: {
          id: true,
          itemType: true,
          itemName: true,
          categoryType: true,
          lineTotal: true,
          notes: true,
          spendTreatment: true,
          classificationStatus: true,
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
        const treatmentBucket: ClassifiedSpendBucket =
          line.spendTreatment === 'CAPEX'
            ? 'capex'
            : line.spendTreatment === 'INVENTORY'
              ? 'inventory'
              : line.spendTreatment === 'REVIEW'
                ? 'review'
                : 'opex';
        const isDirect =
          entry.costRole === 'DIRECT_DELIVERY' || entry.costRole === 'PAYMENT_PROCESSING';
        const matchesBucket =
          bucket === 'direct'
            ? isDirect
            : bucket === 'overhead'
              ? !isDirect && (treatmentBucket === 'opex' || treatmentBucket === 'review')
              : treatmentBucket === bucket;
        if (!matchesBucket) continue;
        const rowBucket = bucket === 'direct' ? 'direct' : treatmentBucket;
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

    const unlinedTreatment: ClassifiedSpendBucket =
      entry.fixedAssets.length
        ? 'capex'
        : entry.costLayers.length
          ? 'inventory'
          : 'review';
    const unlinedDirect =
      entry.costRole === 'DIRECT_DELIVERY' || entry.costRole === 'PAYMENT_PROCESSING';
    const matchesBucket =
      bucket === 'direct'
        ? unlinedDirect
        : bucket === 'overhead'
          ? !unlinedDirect && unlinedTreatment === 'review'
          : bucket === unlinedTreatment;
    if (matchesBucket) {
      const rowBucket = bucket === 'direct' ? 'direct' : unlinedTreatment;
      rows.push({
        id: entry.id,
        bucket: rowBucket,
        date: entry.date,
        month: monthBucketKey(entry.date),
        description: entry.description ?? entry.reference ?? entry.id,
        category:
          entry.categoryType ??
          (unlinedTreatment === 'capex'
            ? 'EQUIPMENT'
            : unlinedTreatment === 'inventory'
              ? 'INVENTORY'
              : 'OVERHEAD'),
        party: entry.party?.name ?? null,
        reference: entry.reference,
        amount: convertToIqd(entry.amount, entry.currency, rate),
        sourceHref: `/finance/ledger/${entry.id}`,
      });
    }
  }

  return rows.filter((row) => matches(row, rowFilters)).sort((a, b) => b.date.getTime() - a.date.getTime());
}

export async function getSpendTotals(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<SpendFacts> {
  const [capex, inventory, opex, review, direct, cogs] = await Promise.all([
    getSpendRows('capex', filters, scope, range),
    getSpendRows('inventory', filters, scope, range),
    getSpendRows('opex', filters, scope, range),
    getSpendRows('review', filters, scope, range),
    getSpendRows('direct', filters, scope, range),
    getSpendRows('cogs', filters, scope, range),
  ]);
  const sum = (rows: SpendRow[]) => rows.reduce((total, row) => total + row.amount, 0);
  const capexTotal = sum(capex);
  const inventoryTotal = sum(inventory);
  const opexTotal = sum(opex);
  const reviewTotal = sum(review);
  const directTotal = sum(direct);
  const operatingTotal = opexTotal + reviewTotal;
  return {
    capex: capexTotal,
    inventory: inventoryTotal,
    opex: opexTotal,
    review: reviewTotal,
    operating: operatingTotal,
    direct: directTotal,
    cogs: sum(cogs),
    totalSpent: capexTotal + inventoryTotal + operatingTotal,
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
