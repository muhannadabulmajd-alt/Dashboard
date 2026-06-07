import 'server-only';
import type { RoastLevel } from '@prisma/client';
import { prisma } from '../client';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';

type Scope = { branchId?: string };

export interface BatchRow {
  batchNumber: string;
  roastDate: Date | null;
  origin: string;
  roastLevel: RoastLevel | null;
  greenInputGrams: number;
  roastedOutputGrams: number | null;
  qcScore: number | null;
  operatorName: string | null;
  skuCount: number;
}

export async function getBatchRows(
  _filters: DashboardFilters,
  scope: Scope,
  _range: ResolvedRange,
): Promise<BatchRow[]> {
  // Return every batch (branch-scoped), including green-only logged ones with no
  // roast results yet. The page computes roast metrics from the roasted subset.
  const rows = await prisma.roastBatch.findMany({
    where: scope.branchId ? { branchId: scope.branchId } : {},
    orderBy: [{ roastDate: { sort: 'desc', nulls: 'last' } }, { batchNumber: 'asc' }],
    select: {
      batchNumber: true,
      roastDate: true,
      origin: true,
      roastLevel: true,
      greenInputGrams: true,
      roastedOutputGrams: true,
      qcScore: true,
      operator: { select: { name: true } },
      _count: { select: { skuLinks: true } },
    },
  });
  return rows.map((r) => ({
    batchNumber: r.batchNumber,
    roastDate: r.roastDate,
    origin: r.origin,
    roastLevel: r.roastLevel,
    greenInputGrams: r.greenInputGrams,
    roastedOutputGrams: r.roastedOutputGrams,
    qcScore: r.qcScore,
    operatorName: r.operator?.name ?? null,
    skuCount: r._count.skuLinks,
  }));
}
