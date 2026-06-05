import { describe, it, expect } from 'vitest';
import { offerPerformance } from '@/lib/metrics/offers';
import type { OfferOrderLike } from '@/lib/metrics/types';

const START = new Date('2026-05-01T00:00:00Z');
const END = new Date('2026-05-31T23:59:59Z');

function oo(over: Partial<OfferOrderLike>): OfferOrderLike {
  return {
    offerId: 'o1',
    customerId: 'c1',
    status: 'COMPLETED',
    grossAmount: 10000,
    discountAmount: 1000,
    refundAmount: 0,
    ...over,
  };
}

describe('offer metrics', () => {
  it('aggregates per offer and counts acquired new customers', () => {
    const first = new Map<string, Date | null>([
      ['c1', new Date('2026-05-05')], // new in window
      ['c2', new Date('2026-01-01')], // existing
    ]);
    const orders = [
      oo({ offerId: 'o1', customerId: 'c1', grossAmount: 10000, discountAmount: 1000 }),
      oo({ offerId: 'o1', customerId: 'c2', grossAmount: 20000, discountAmount: 2000 }),
      oo({ offerId: 'o2', customerId: 'c1', grossAmount: 5000, discountAmount: 500 }),
      oo({ offerId: null, customerId: 'c2', grossAmount: 9999 }), // no offer, ignored
      oo({ offerId: 'o1', status: 'CANCELLED' }), // cancelled, ignored
    ];
    const stats = offerPerformance(orders, first, START, END);
    const o1 = stats.find((s) => s.offerId === 'o1')!;
    expect(o1.orders).toBe(2);
    expect(o1.revenue).toBe(10000 - 1000 + (20000 - 2000)); // 27000
    expect(o1.discountSpend).toBe(3000);
    expect(o1.newCustomers).toBe(1); // only c1 is new
    expect(stats[0].offerId).toBe('o1'); // sorted by revenue
  });
});
