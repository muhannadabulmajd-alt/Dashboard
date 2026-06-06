import 'server-only';
import type { RoastLevel } from '@prisma/client';
import { prisma } from '../client';
import { buildBatchWhere } from '@/server/filters/where-builder';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';

type Scope = { branchId?: string };

export interface BatchRow {
  batchNumber: string;
  roastDate: Date;
  origin: string;
  roastLevel: RoastLevel;
  greenInputGrams: number;
  roastedOutputGrams: number;
  qcScore: number | null;
  operatorName: string | null;
  skuCount: number;
}

export async function getBatchRows(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<BatchRow[]> {
  // Roastery analytics cover roasted batches; green-only logged batches (no
  // roast output yet) are surfaced in the batch management screen, not here.
  const rows = await prisma.roastBatch.findMany({
    where: {
      AND: [
        buildBatchWhere(filters, scope, range),
        { roastDate: { not: null }, roastLevel: { not: null }, roastedOutputGrams: { not: null } },
      ],
    },
    orderBy: { roastDate: 'desc' },
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
    roastDate: r.roastDate!,
    origin: r.origin,
    roastLevel: r.roastLevel!,
    greenInputGrams: r.greenInputGrams,
    roastedOutputGrams: r.roastedOutputGrams!,
    qcScore: r.qcScore,
    operatorName: r.operator?.name ?? null,
    skuCount: r._count.skuLinks,
  }));
}
