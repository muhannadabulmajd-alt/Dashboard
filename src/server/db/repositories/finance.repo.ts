import 'server-only';
import { prisma } from '../client';
import { buildBatchWhere } from '@/server/filters/where-builder';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';
import type { ExpenseLike, BatchLike } from '@/lib/metrics/types';
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
  const [financeRows, rate] = await Promise.all([
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
        costRole: true,
        party: { select: { name: true } },
        type: true,
        categoryType: true,
        ledgerLines: {
          select: {
            lineTotal: true,
            categoryType: true,
            branchId: true,
            spendTreatment: true,
          },
        },
        fixedAssets: { take: 1, select: { id: true } },
        costLayers: { take: 1, select: { id: true } },
      },
    }),
    getUsdToIqd(),
  ]);
  return financeRows.flatMap((r) => {
    if (r.costRole === 'DIRECT_DELIVERY' || r.costRole === 'PAYMENT_PROCESSING') return [];
    if (r.ledgerLines.length) {
      return r.ledgerLines
        .filter((line) => line.spendTreatment === 'OPEX' || line.spendTreatment === 'REVIEW')
        .map((line) => ({
          amount: convertToIqd(line.lineTotal, r.currency, rate),
          currency: 'IQD' as const,
          incurredAt: r.date,
          categoryType: line.categoryType ?? r.categoryType ?? 'OVERHEAD',
          branchId: line.branchId ?? r.branchId,
          partyName: r.party?.name ?? null,
        }));
    }
    if (r.fixedAssets.length || r.costLayers.length) return [];
    return [
      {
        amount: convertToIqd(r.amount, r.currency, rate),
        currency: 'IQD' as const,
        incurredAt: r.date,
        categoryType: r.categoryType ?? 'OVERHEAD',
        branchId: r.branchId,
        partyName: r.party?.name ?? null,
      },
    ];
  });
}

async function getDirectCostsByRole(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
  costRole: 'DIRECT_DELIVERY' | 'PAYMENT_PROCESSING',
): Promise<number> {
  const [rows, rate] = await Promise.all([
    prisma.financeEntry.findMany({
      where: {
        type: { in: ['EXPENSE', 'PURCHASE'] },
        costRole,
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
      select: { amount: true, currency: true },
    }),
    getUsdToIqd(),
  ]);
  return rows.reduce((sum, row) => sum + convertToIqd(row.amount, row.currency, rate), 0);
}

export function getDirectDeliveryCosts(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<number> {
  return getDirectCostsByRole(filters, scope, range, 'DIRECT_DELIVERY');
}

export async function getPaymentProcessingCosts(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<number> {
  return getDirectCostsByRole(filters, scope, range, 'PAYMENT_PROCESSING');
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
