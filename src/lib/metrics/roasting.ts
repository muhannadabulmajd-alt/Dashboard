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
