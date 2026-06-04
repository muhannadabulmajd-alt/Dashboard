import { describe, it, expect } from 'vitest';
import { resolveRange, bucketKey, monthProgress } from '@/lib/dates';

// Baghdad is UTC+3 (no DST). 10:00Z == 13:00 Baghdad on the same day.
const NOW = new Date('2026-05-15T10:00:00.000Z');

describe('resolveRange (Baghdad-local boundaries)', () => {
  it('today spans the Baghdad-local day as UTC instants', () => {
    const r = resolveRange({ range: 'today' }, NOW);
    expect(r.start.toISOString()).toBe('2026-05-14T21:00:00.000Z'); // 00:00 Baghdad
    expect(r.end.toISOString()).toBe('2026-05-15T20:59:59.999Z'); // 23:59:59.999 Baghdad
    // previous comparable window is the prior day
    expect(r.prevStart!.toISOString()).toBe('2026-05-13T21:00:00.000Z');
  });

  it('this_month uses calendar month and last month as the prev window', () => {
    const r = resolveRange({ range: 'this_month' }, NOW);
    expect(r.start.toISOString()).toBe('2026-04-30T21:00:00.000Z'); // 1 May 00:00 Baghdad
    expect(r.prevStart!.toISOString()).toBe('2026-03-31T21:00:00.000Z'); // 1 Apr 00:00 Baghdad
  });

  it('all has no previous window', () => {
    const r = resolveRange({ range: 'all' }, NOW);
    expect(r.prevStart).toBeUndefined();
  });
});

describe('bucketKey', () => {
  it('buckets by Baghdad-local day, crossing UTC midnight correctly', () => {
    expect(bucketKey(new Date('2026-05-15T10:00:00Z'), 'day')).toBe('2026-05-15');
    // 22:00Z == 01:00 Baghdad next day
    expect(bucketKey(new Date('2026-05-15T22:00:00Z'), 'day')).toBe('2026-05-16');
  });

  it('buckets by Baghdad-local hour', () => {
    expect(bucketKey(new Date('2026-05-15T10:00:00Z'), 'hour')).toBe('13');
  });
});

describe('monthProgress', () => {
  it('reports day-of-month and days-in-month in Baghdad time', () => {
    const { dayOfMonth, daysInMonth } = monthProgress(NOW);
    expect(dayOfMonth).toBe(15);
    expect(daysInMonth).toBe(31);
  });
});
