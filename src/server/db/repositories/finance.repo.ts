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
  return prisma.roastBatch.findMany({
    where: buildBatchWhere(filters, scope, range),
    select: {
      greenInputGrams: true,
      roastedOutputGrams: true,
      roastLevel: true,
      roastDate: true,
    },
  });
}
