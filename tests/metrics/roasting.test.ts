import { describe, it, expect } from 'vitest';
import {
  roastingYieldPct,
  shrinkagePct,
  avgShrinkage,
  roastLevelMix,
} from '@/lib/metrics/roasting';
import type { BatchLike } from '@/lib/metrics/types';

describe('roasting metrics', () => {
  it('yield and shrinkage are complementary', () => {
    // 1000g green -> 830g roasted = 83% yield, 17% shrinkage
    expect(roastingYieldPct(1_000, 830)).toBeCloseTo(0.83, 6);
    expect(shrinkagePct(1_000, 830)).toBeCloseTo(0.17, 6);
  });

  it('guards zero input', () => {
    expect(roastingYieldPct(0, 0)).toBe(0);
    expect(shrinkagePct(0, 0)).toBe(0);
  });

  it('avgShrinkage is weighted across batches', () => {
    const batches: BatchLike[] = [
      { greenInputGrams: 1_000, roastedOutputGrams: 850, roastLevel: 'MEDIUM', roastDate: new Date() },
      { greenInputGrams: 1_000, roastedOutputGrams: 830, roastLevel: 'DARK', roastDate: new Date() },
    ];
    // total 2000 -> 1680, shrinkage = 1 - 1680/2000 = 0.16
    expect(avgShrinkage(batches)).toBeCloseTo(0.16, 6);
  });

  it('roastLevelMix computes share by output', () => {
    const batches: BatchLike[] = [
      { greenInputGrams: 0, roastedOutputGrams: 600, roastLevel: 'MEDIUM', roastDate: new Date() },
      { greenInputGrams: 0, roastedOutputGrams: 400, roastLevel: 'DARK', roastDate: new Date() },
    ];
    const mix = roastLevelMix(batches);
    expect(mix[0].roastLevel).toBe('MEDIUM');
    expect(mix[0].pct).toBeCloseTo(0.6, 6);
  });
});
