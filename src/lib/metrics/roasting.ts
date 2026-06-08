import type { RoastLevel } from '@prisma/client';
import type { BatchLike } from './types';

/** Roasting yield = roasted output / green input (0..1). */
export function roastingYieldPct(greenInputGrams: number, roastedOutputGrams: number): number {
  return greenInputGrams > 0 ? roastedOutputGrams / greenInputGrams : 0;
}

/** Shrinkage = 1 - yield. */
export function shrinkagePct(greenInputGrams: number, roastedOutputGrams: number): number {
  return greenInputGrams > 0 ? 1 - roastingYieldPct(greenInputGrams, roastedOutputGrams) : 0;
}

export function totalGreenInput(batches: BatchLike[]): number {
  return batches.reduce((s, b) => s + b.greenInputGrams, 0);
}

export function totalRoastedOutput(batches: BatchLike[]): number {
  return batches.reduce((s, b) => s + b.roastedOutputGrams, 0);
}

/** Weighted average shrinkage across batches. */
export function avgShrinkage(batches: BatchLike[]): number {
  const green = totalGreenInput(batches);
  const roasted = totalRoastedOutput(batches);
  return shrinkagePct(green, roasted);
}

export function roastLevelMix(
  batches: BatchLike[],
): { roastLevel: RoastLevel; outputGrams: number; pct: number }[] {
  const map = new Map<RoastLevel, number>();
  let total = 0;
  for (const b of batches) {
    map.set(b.roastLevel, (map.get(b.roastLevel) ?? 0) + b.roastedOutputGrams);
    total += b.roastedOutputGrams;
  }
  return [...map.entries()]
    .map(([roastLevel, outputGrams]) => ({
      roastLevel,
      outputGrams,
      pct: total > 0 ? outputGrams / total : 0,
    }))
    .sort((a, b) => b.outputGrams - a.outputGrams);
}

export interface OperatorBatch {
  operatorName: string | null;
  greenInputGrams: number;
  roastedOutputGrams: number;
}

export function operatorActivity(
  batches: OperatorBatch[],
): { operator: string; batches: number; outputGrams: number; shrinkagePct: number }[] {
  const map = new Map<string, { batches: number; green: number; roasted: number }>();
  for (const b of batches) {
    const key = b.operatorName ?? '—';
    const e = map.get(key) ?? { batches: 0, green: 0, roasted: 0 };
    e.batches += 1;
    e.green += b.greenInputGrams;
    e.roasted += b.roastedOutputGrams;
    map.set(key, e);
  }
  return [...map.entries()]
    .map(([operator, e]) => ({
      operator,
      batches: e.batches,
      outputGrams: e.roasted,
      shrinkagePct: shrinkagePct(e.green, e.roasted),
    }))
    .sort((a, b) => b.outputGrams - a.outputGrams);
}

export function avgQcScore(batches: { qcScore: number | null }[]): number {
  const scores = batches.map((b) => b.qcScore).filter((s): s is number => s != null);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
}

/** QC-score distribution: count of scored batches per 5-point band (e.g. 85 → 85–90). */
export function qcDistribution(
  batches: { qcScore: number | null }[],
  bandSize = 5,
): { band: number; count: number }[] {
  const map = new Map<number, number>();
  for (const b of batches) {
    if (b.qcScore == null) continue;
    const band = Math.floor(b.qcScore / bandSize) * bandSize;
    map.set(band, (map.get(band) ?? 0) + 1);
  }
  return [...map.entries()].map(([band, count]) => ({ band, count })).sort((a, b) => a.band - b.band);
}
