import 'server-only';
import { prisma } from '../client';
import { buildExpenseWhere, buildBatchWhere } from '@/server/filters/where-builder';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';
import type { ExpenseLike, BatchLike } from '@/lib/metrics/types';

type Scope = { branchId?: string };

export async function getExpenses(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<ExpenseLike[]> {
  const rows = await prisma.expense.findMany({
    where: buildExpenseWhere(filters, scope, range),
    select: {
      amount: true,
      currency: true,
      incurredAt: true,
      category: { select: { type: true } },
    },
  });
  return rows.map((r) => ({
    amount: r.amount,
    currency: r.currency,
    incurredAt: r.incurredAt,
    categoryType: r.category.type,
  }));
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
