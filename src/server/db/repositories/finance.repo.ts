import 'server-only';
import { prisma } from '../client';
import { buildExpenseWhere, buildBatchWhere } from '@/server/filters/where-builder';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';
import type { ExpenseLike, BatchLike } from '@/lib/metrics/types';
import { classifyPurchase } from '@/lib/metrics/purchases';
import { getUsdToIqd } from '@/server/settings';
import { convertToIqd } from '@/lib/money';

type Scope = { branchId?: string };

export interface OperatingExpenseFact extends ExpenseLike {
  partyName: string | null;
}

export async function getOperatingExpenseFacts(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<OperatingExpenseFact[]> {
  const [expenseRows, financeRows, rate] = await Promise.all([
    prisma.expense.findMany({
      where: buildExpenseWhere(filters, scope, range),
      select: {
        amount: true,
        currency: true,
        incurredAt: true,
        branchId: true,
        vendor: true,
        category: { select: { type: true } },
      },
    }),
    // Purchase parents may contain inventory, assets and operating lines. Only
    // the operating allocation feeds P&L; cash flow still sees the full parent.
    prisma.financeEntry.findMany({
      where: {
        type: { in: ['EXPENSE', 'PURCHASE'] },
        date: { gte: range.start, lte: range.end },
        archivedAt: null,
        reversedAt: null,
        reversalOfId: null,
        ...(scope.branchId
          ? { branchId: scope.branchId }
          : filters.branchId?.length
            ? { branchId: { in: filters.branchId } }
            : {}),
      },
      select: {
        amount: true,
        currency: true,
        date: true,
        branchId: true,
        party: { select: { name: true } },
        type: true,
        categoryType: true,
        ledgerLines: { select: { itemType: true, lineTotal: true, categoryType: true, branchId: true } },
        fixedAssets: { take: 1, select: { id: true } },
        costLayers: { take: 1, select: { id: true } },
      },
    }),
    getUsdToIqd(),
  ]);
  return [
    ...expenseRows.map((r) => ({
      amount: convertToIqd(r.amount, r.currency, rate),
      currency: 'IQD' as const,
      incurredAt: r.incurredAt,
      categoryType: r.category.type,
      branchId: r.branchId,
      partyName: r.vendor,
    })),
    ...financeRows.flatMap((r) => {
      if (r.type === 'EXPENSE') {
        return [{ amount: convertToIqd(r.amount, r.currency, rate), currency: 'IQD' as const, incurredAt: r.date, categoryType: r.categoryType ?? 'OVERHEAD', branchId: r.branchId, partyName: r.party?.name ?? null }];
      }
      const allocation = classifyPurchase({
        amount: r.amount,
        categoryType: r.categoryType,
        ledgerLines: r.ledgerLines,
        hasFixedAsset: r.fixedAssets.length > 0,
        hasInventoryLayer: r.costLayers.length > 0,
      });
      if (allocation.operatingExpense <= 0) return [];
      const categories = r.ledgerLines
        .filter((line) => line.itemType !== 'INVENTORY')
        .map((line) => line.categoryType)
        .filter((value): value is NonNullable<typeof value> => value != null);
      const categoryType = categories.length && categories.every((value) => value === categories[0])
        ? categories[0]
        : r.categoryType ?? 'OVERHEAD';
      return [{ amount: convertToIqd(allocation.operatingExpense, r.currency, rate), currency: 'IQD' as const, incurredAt: r.date, categoryType, branchId: r.branchId, partyName: r.party?.name ?? null }];
    }),
  ];
}

export async function getExpenses(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<ExpenseLike[]> {
  return getOperatingExpenseFacts(filters, scope, range);
}

export async function getBatches(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<BatchLike[]> {
  // Only fully-roasted batches feed cost/yield metrics; green-only logged
  // batches (no roast output yet) are excluded.
  const rows = await prisma.roastBatch.findMany({
    where: {
      AND: [
        buildBatchWhere(filters, scope, range),
        { roastDate: { not: null }, roastLevel: { not: null }, roastedOutputGrams: { not: null } },
      ],
    },
    select: {
      greenInputGrams: true,
      roastedOutputGrams: true,
      roastLevel: true,
      roastDate: true,
    },
  });
  return rows.map((r) => ({
    greenInputGrams: r.greenInputGrams,
    roastedOutputGrams: r.roastedOutputGrams!,
    roastLevel: r.roastLevel!,
    roastDate: r.roastDate!,
  }));
}
