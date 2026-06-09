import { describe, it, expect } from 'vitest';
import {
  roastingYieldPct,
  shrinkagePct,
  avgShrinkage,
  roastLevelMix,
  operatorActivity,
  avgQcScore,
  qcDistribution,
  roastedCostPerKg,
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

  it('operatorActivity aggregates per operator with shrinkage', () => {
    const rows = operatorActivity([
      { operatorName: 'Ali', greenInputGrams: 1000, roastedOutputGrams: 850 },
      { operatorName: 'Ali', greenInputGrams: 1000, roastedOutputGrams: 830 },
      { operatorName: 'Sara', greenInputGrams: 500, roastedOutputGrams: 430 },
    ]);
    const ali = rows.find((r) => r.operator === 'Ali')!;
    expect(ali.batches).toBe(2);
    expect(ali.outputGrams).toBe(1680);
    expect(ali.shrinkagePct).toBeCloseTo(0.16, 6); // 1 - 1680/2000
  });

  it('avgQcScore ignores nulls', () => {
    expect(avgQcScore([{ qcScore: 80 }, { qcScore: 90 }, { qcScore: null }])).toBe(85);
  });

  it('qcDistribution buckets scores into 5-point bands', () => {
    const d = qcDistribution([{ qcScore: 80 }, { qcScore: 82 }, { qcScore: 88 }, { qcScore: 90 }, { qcScore: null }]);
    expect(d).toEqual([
      { band: 80, count: 2 },
      { band: 85, count: 1 },
      { band: 90, count: 1 },
    ]);
  });

  it('roastedCostPerKg = green cost ÷ yield (+ roasting cost) (§5.3)', () => {
    expect(roastedCostPerKg(10_000, 0.85)).toBe(11_765);
    expect(roastedCostPerKg(10_000, 0.85, 500)).toBe(12_265);
    expect(roastedCostPerKg(10_000, 0)).toBe(0);
  });
});
