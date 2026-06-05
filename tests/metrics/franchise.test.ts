import { describe, it, expect } from 'vitest';
import { franchiseReadinessScore, DEFAULT_READINESS_TARGETS } from '@/lib/metrics/franchise';

describe('franchise readiness score', () => {
  it('is 100 when every signal meets its target', () => {
    const r = franchiseReadinessScore({ netSales: 20_000_000, marginPct: 0.4, orders: 150 });
    expect(r.score).toBe(100);
    expect(r.parts.every((p) => p.score === 100)).toBe(true);
  });

  it('is 0 with no activity', () => {
    expect(franchiseReadinessScore({ netSales: 0, marginPct: 0, orders: 0 }).score).toBe(0);
  });

  it('caps each signal at its target (over-performance does not exceed 100)', () => {
    const r = franchiseReadinessScore({ netSales: 100_000_000, marginPct: 0.9, orders: 999 });
    expect(r.score).toBe(100);
  });

  it('weights sales/margin/orders at 35/35/30', () => {
    // Only sales at target -> 35
    const r = franchiseReadinessScore({ netSales: DEFAULT_READINESS_TARGETS.sales, marginPct: 0, orders: 0 });
    expect(r.score).toBe(35);
  });
});
