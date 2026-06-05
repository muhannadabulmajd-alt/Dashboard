import { describe, it, expect } from 'vitest';
import {
  deliveryDays,
  avgDeliveryDays,
  deliverySlaPct,
  failedDeliveryRate,
  returnRate,
  courierComparison,
} from '@/lib/metrics/fulfillment';
import type { ShipmentLike } from '@/lib/metrics/types';
import { makeOrder } from '../fixtures/builders';

function ship(over: Partial<ShipmentLike>): ShipmentLike {
  return {
    status: 'DELIVERED',
    dispatchedAt: new Date('2026-05-10T00:00:00Z'),
    deliveredAt: new Date('2026-05-12T00:00:00Z'),
    shippingCost: 4000,
    courier: 'A',
    governorate: 'BAGHDAD',
    placedAt: new Date('2026-05-09T00:00:00Z'),
    ...over,
  };
}

describe('fulfillment metrics', () => {
  it('delivery time is dispatch to delivered in days', () => {
    expect(deliveryDays(ship({}))).toBe(2);
    expect(deliveryDays(ship({ status: 'FAILED', deliveredAt: null }))).toBeNull();
  });

  it('SLA is on-time deliveries over delivered', () => {
    const shipments = [
      ship({ deliveredAt: new Date('2026-05-11T00:00:00Z') }), // 1 day
      ship({ deliveredAt: new Date('2026-05-12T00:00:00Z') }), // 2 days
      ship({ deliveredAt: new Date('2026-05-16T00:00:00Z') }), // 6 days (late)
      ship({ status: 'IN_TRANSIT', deliveredAt: null }), // not delivered (ignored)
    ];
    expect(deliverySlaPct(shipments, 3)).toBeCloseTo(2 / 3, 6);
    expect(avgDeliveryDays(shipments)).toBeCloseTo((1 + 2 + 6) / 3, 6);
  });

  it('failed rate counts failed + returned over all shipments', () => {
    const shipments = [ship({}), ship({ status: 'FAILED' }), ship({ status: 'RETURNED' }), ship({})];
    expect(failedDeliveryRate(shipments)).toBeCloseTo(0.5, 6);
  });

  it('return rate is returned/refunded over sales orders', () => {
    const orders = [
      makeOrder({ status: 'COMPLETED' }),
      makeOrder({ status: 'RETURNED' }),
      makeOrder({ status: 'CANCELLED' }), // not a sales order, excluded
    ];
    expect(returnRate(orders)).toBeCloseTo(1 / 2, 6);
  });

  it('courier comparison groups by courier', () => {
    const shipments = [
      ship({ courier: 'A' }),
      ship({ courier: 'A', status: 'FAILED', deliveredAt: null }),
      ship({ courier: 'B' }),
    ];
    const stats = courierComparison(shipments);
    expect(stats[0].courier).toBe('A');
    expect(stats[0].shipments).toBe(2);
    expect(stats[0].delivered).toBe(1);
  });
});
