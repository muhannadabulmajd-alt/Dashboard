import { describe, expect, it } from 'vitest';
import type { OrderLike, OrderLineWithProduct } from '@/lib/metrics/types';
import { aggregateProductBuyers } from '@/server/customers/product-buyers';

const product = {
  id: 'product-1',
  sku: 'LHB-DRP-BOX10-15G-DB-M',
  nameEn: '10 drip bags',
  nameAr: '10 أكياس تقطير',
  productLine: 'DRIP_BAGS' as const,
  grind: 'FILTER',
  sizeLabel: '10 x 15g',
  groupId: null,
  group: null,
};

function order(id: string, customerId: string | null, placedAt: string): OrderLike {
  return {
    id,
    branchId: null,
    offerId: null,
    placedAt: new Date(placedAt),
    status: 'COMPLETED',
    metricRole: 'SALE',
    purpose: 'SALE',
    channel: 'ONLINE_STORE',
    governorate: 'BAGHDAD',
    customerId,
    currency: 'IQD',
    grossAmount: 20_000,
    discountAmount: 0,
    refundAmount: 0,
    deliveryFee: 0,
    extraCharges: 0,
    deliveryCost: 0,
  };
}

function line(orderId: string, quantity: number, lineNet: number): OrderLineWithProduct {
  return {
    productId: product.id,
    orderId,
    branchId: null,
    customerId: null,
    sku: product.sku,
    quantity,
    unitGrossPrice: 10_000,
    lineDiscount: 0,
    lineNet,
    unitCogsSnapshot: 4_000,
    product,
  };
}

describe('product buyer aggregation', () => {
  it('deduplicates repeat customers and reconciles orders, units, and allocated product sales', () => {
    const result = aggregateProductBuyers(
      [
        order('order-1', 'customer-a', '2026-07-01T09:00:00.000Z'),
        order('order-2', 'customer-a', '2026-07-03T09:00:00.000Z'),
        order('order-3', 'customer-b', '2026-07-02T09:00:00.000Z'),
      ],
      [line('order-1', 1, 10_000), line('order-2', 2, 20_000), line('order-3', 1, 9_000)],
      [
        { id: 'customer-a', externalId: 'CUS-A', nameEn: 'A', nameAr: null, phone: '111', governorate: 'BAGHDAD' },
        { id: 'customer-b', externalId: 'CUS-B', nameEn: 'B', nameAr: null, phone: '222', governorate: 'ERBIL' },
      ],
    );

    expect(result).toMatchObject({ orderCount: 3, units: 4, itemSales: 39_000, guestOrderCount: 0 });
    expect(result.buyers).toHaveLength(2);
    expect(result.buyers[0]).toMatchObject({
      customerId: 'customer-a',
      orders: 2,
      units: 3,
      itemSales: 30_000,
    });
    expect(result.buyers[0].firstPurchaseAt.toISOString()).toBe('2026-07-01T09:00:00.000Z');
    expect(result.buyers[0].lastPurchaseAt.toISOString()).toBe('2026-07-03T09:00:00.000Z');
  });

  it('counts guest sales without exposing a fabricated customer', () => {
    const result = aggregateProductBuyers(
      [order('guest-order', null, '2026-07-04T09:00:00.000Z')],
      [line('guest-order', 2, 18_000)],
      [],
    );

    expect(result.buyers).toEqual([]);
    expect(result).toMatchObject({ orderCount: 1, units: 2, itemSales: 18_000, guestOrderCount: 1 });
  });
});
