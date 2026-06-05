import { describe, it, expect } from 'vitest';
import {
  classifyNewReturning,
  repeatPurchaseRate,
  frequencySegmentCounts,
  firstToSecondConversion,
  cohortRetention,
  customersByCity,
} from '@/lib/metrics/customers';
import type { CustomerLike } from '@/lib/metrics/types';
import { makeOrder } from '../fixtures/builders';

const START = new Date('2026-05-01T00:00:00Z');
const END = new Date('2026-05-31T23:59:59Z');

describe('customer metrics', () => {
  it('classifies new vs returning by first-order date', () => {
    const orders = [
      makeOrder({ customerId: 'c1', placedAt: new Date('2026-05-10') }),
      makeOrder({ customerId: 'c2', placedAt: new Date('2026-05-12') }),
      makeOrder({ customerId: 'c3', placedAt: new Date('2026-05-20') }),
    ];
    const first = new Map<string, Date | null>([
      ['c1', new Date('2026-05-05')], // new
      ['c2', new Date('2026-03-01')], // returning
      ['c3', new Date('2026-05-20')], // new
    ]);
    const nr = classifyNewReturning(orders, first, START, END);
    expect(nr).toEqual({ newCount: 2, returning: 1, total: 3 });
    expect(repeatPurchaseRate(nr)).toBeCloseTo(1 / 3, 6);
  });

  it('counts frequency segments', () => {
    const customers = [
      { segment: 'LOYAL' },
      { segment: 'LOYAL' },
      { segment: 'NEW' },
    ] as CustomerLike[];
    const counts = frequencySegmentCounts(customers);
    expect(counts[0]).toEqual({ segment: 'LOYAL', count: 2 });
  });

  it('computes first-to-second conversion within a window', () => {
    const orders = [
      { customerId: 'c1', placedAt: new Date('2026-05-05'), status: 'COMPLETED' as const },
      { customerId: 'c1', placedAt: new Date('2026-05-15'), status: 'COMPLETED' as const },
      { customerId: 'c2', placedAt: new Date('2026-05-12'), status: 'COMPLETED' as const },
      { customerId: 'c4', placedAt: new Date('2026-04-01'), status: 'COMPLETED' as const },
    ];
    // cohort (first order in May): c1, c2 -> c1 reordered within 30d -> 0.5
    expect(firstToSecondConversion(orders, START, END, 30)).toBeCloseTo(0.5, 6);
  });

  it('builds a monthly cohort retention grid', () => {
    const orders = [
      { customerId: 'c1', placedAt: new Date('2026-03-10'), status: 'COMPLETED' as const },
      { customerId: 'c1', placedAt: new Date('2026-04-05'), status: 'COMPLETED' as const },
      { customerId: 'c2', placedAt: new Date('2026-03-20'), status: 'COMPLETED' as const },
      { customerId: 'c3', placedAt: new Date('2026-04-02'), status: 'COMPLETED' as const },
    ];
    const grid = cohortRetention(orders, 3);
    const march = grid.find((g) => g.cohort === '2026-03')!;
    expect(march.size).toBe(2);
    expect(march.retention[0]).toBe(1);
    expect(march.retention[1]).toBeCloseTo(0.5, 6); // only c1 active in April
    expect(march.retention[2]).toBe(0);
  });

  it('counts active customers by city', () => {
    const customers = [
      { governorate: 'BAGHDAD', ordersCount: 3 },
      { governorate: 'BAGHDAD', ordersCount: 1 },
      { governorate: 'ERBIL', ordersCount: 2 },
      { governorate: 'ERBIL', ordersCount: 0 }, // inactive -> excluded
    ] as CustomerLike[];
    const byCity = customersByCity(customers);
    expect(byCity[0]).toEqual({ governorate: 'BAGHDAD', count: 2 });
    expect(byCity.find((c) => c.governorate === 'ERBIL')!.count).toBe(1);
  });
});
