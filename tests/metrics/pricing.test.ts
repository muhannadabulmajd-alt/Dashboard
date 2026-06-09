import { describe, it, expect } from 'vitest';
import { effectivePrice, scheduledPrices, type PriceEntry } from '@/lib/metrics/pricing';

const now = new Date('2026-06-09T00:00:00.000Z');
const entries: PriceEntry[] = [
  { kind: 'BASE', price: 8_000, effectiveFrom: new Date('2026-01-01') },
  { kind: 'BASE', price: 9_000, effectiveFrom: new Date('2026-05-01') }, // latest due
  { kind: 'BASE', price: 10_000, effectiveFrom: new Date('2026-08-01') }, // scheduled
  { kind: 'WHOLESALE', price: 7_000, effectiveFrom: new Date('2026-05-01') },
  { kind: 'CHANNEL', channel: 'ONLINE_STORE', price: 9_500, effectiveFrom: new Date('2026-07-01') },
];

describe('pricing metrics (§6)', () => {
  it('effectivePrice picks the latest BASE entry due by now', () => {
    expect(effectivePrice(entries, 5_000, now)).toBe(9_000);
  });

  it('effectivePrice falls back when no BASE entry is due yet', () => {
    expect(effectivePrice([{ kind: 'BASE', price: 12_000, effectiveFrom: new Date('2026-12-01') }], 5_000, now)).toBe(5_000);
    expect(effectivePrice([], 5_000, now)).toBe(5_000);
  });

  it('effectivePrice ignores non-BASE entries', () => {
    expect(effectivePrice([{ kind: 'WHOLESALE', price: 7_000, effectiveFrom: new Date('2026-01-01') }], 5_000, now)).toBe(5_000);
  });

  it('scheduledPrices returns future entries soonest-first, across kinds', () => {
    const s = scheduledPrices(entries, now);
    expect(s.map((e) => e.price)).toEqual([9_500, 10_000]); // 2026-07 then 2026-08
  });
});
