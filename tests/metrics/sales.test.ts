import { describe, it, expect } from 'vitest';
import {
  grossSales,
  netSales,
  discountTotal,
  completedOrderCount,
  salesOrderCount,
  orderCompletionRate,
  unitsSold,
  aov,
  avgUnitPrice,
  discountEffect,
  salesByDimension,
  salesByGroup,
  productMix,
  topProducts,
  slowMovers,
  preferenceBy,
  allocateInteger,
} from '@/lib/metrics/sales';
import { makeOrder, makeLine, makeProduct } from '../fixtures/builders';

describe('sales metrics', () => {
  const orders = [
    makeOrder({ grossAmount: 100_000, discountAmount: 10_000, status: 'COMPLETED', channel: 'ONLINE_STORE' }),
    makeOrder({ grossAmount: 50_000, discountAmount: 0, status: 'COMPLETED', channel: 'POS' }),
    makeOrder({ grossAmount: 30_000, status: 'CANCELLED' }), // excluded everywhere
    makeOrder({ grossAmount: 40_000, refundAmount: 40_000, status: 'RETURNED', channel: 'ONLINE_STORE' }),
  ];

  it('grossSales includes completed sales only', () => {
    expect(grossSales(orders)).toBe(150_000);
  });

  it('netSales subtracts discounts and refunds', () => {
    expect(netSales(orders)).toBe(140_000);
  });

  it('discountTotal sums discounts of sales orders', () => {
    expect(discountTotal(orders)).toBe(10_000);
  });

  it('completedOrderCount counts statuses mapped as sales', () => {
    expect(completedOrderCount(orders)).toBe(2);
    expect(completedOrderCount([...orders, makeOrder({ status: 'CUSTOM', metricRole: 'SALE' })])).toBe(3);
  });

  it('salesOrderCount counts completed sales only', () => {
    expect(salesOrderCount(orders)).toBe(2);
  });

  it('orderCompletionRate = completed / sales orders', () => {
    expect(orderCompletionRate(orders)).toBe(1);
  });

  it('aov and avgUnitPrice handle zero denominators', () => {
    expect(aov(140_000, 2)).toBe(70_000);
    expect(aov(140_000, 0)).toBe(0);
    expect(avgUnitPrice(140_000, 7)).toBe(20_000);
    expect(avgUnitPrice(140_000, 0)).toBe(0);
  });

  it('discountEffect computes effective discount rate', () => {
    const { discountSpend, netSales: net, effectivePct } = discountEffect(orders);
    expect(discountSpend).toBe(10_000);
    expect(net).toBe(140_000);
    // 10k / (140k + 10k) = 0.0666...
    expect(effectivePct).toBeCloseTo(10_000 / 150_000, 6);
  });

  it('salesByDimension groups net sales by channel', () => {
    const byChannel = salesByDimension(orders, 'channel');
    const online = byChannel.find((b) => b.key === 'ONLINE_STORE')!;
    const pos = byChannel.find((b) => b.key === 'POS')!;
    expect(online.netSales).toBe(90_000);
    expect(online.orders).toBe(1);
    expect(pos.netSales).toBe(50_000);
    // sorted descending by net sales
    expect(byChannel[0].key).toBe('ONLINE_STORE');
  });

  it('allocates integer totals exactly and deterministically', () => {
    const allocated = allocateInteger(100, [1, 1, 1]);
    expect(allocated).toEqual([34, 33, 33]);
    expect(allocated.reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it('excludes unknown managed statuses until they receive a metric role', () => {
    expect(netSales([makeOrder({ status: 'CUSTOM_STATUS', grossAmount: 99_000 })])).toBe(0);
    expect(netSales([makeOrder({ status: 'CUSTOM_STATUS', metricRole: 'SALE', grossAmount: 99_000 })])).toBe(99_000);
  });

  it('salesByGroup rolls variations up to their parent group', () => {
    const g = { nameEn: 'Espresso Spring', nameAr: 'إسبريسو سبرنغ' };
    const lines = [
      makeLine({ product: makeProduct({ id: 'a', groupId: 'g1', group: g }), quantity: 2, lineNet: 36_000 }),
      makeLine({ product: makeProduct({ id: 'b', groupId: 'g1', group: g }), quantity: 1, lineNet: 18_000 }),
      makeLine({ product: makeProduct({ id: 'c', nameEn: 'Solo', nameAr: 'منفرد' }), quantity: 1, lineNet: 5_000 }),
    ];
    const r = salesByGroup(lines);
    expect(r[0]).toMatchObject({ key: 'g1', nameEn: 'Espresso Spring', netSales: 54_000, units: 3 });
    expect(r[1]).toMatchObject({ key: 'prod:c', nameEn: 'Solo', netSales: 5_000, units: 1 });
  });
});

describe('product-level breakdowns', () => {
  const espresso = makeProduct({ id: 'esp', grind: 'ESPRESSO', sizeLabel: '250g', nameEn: 'Espresso' });
  const turkish = makeProduct({ id: 'tur', grind: 'TURKISH', sizeLabel: '500g', nameEn: 'Turkish' });
  const lines = [
    makeLine({ product: espresso, quantity: 3, lineNet: 30_000, unitCogsSnapshot: 6_000 }),
    makeLine({ product: espresso, quantity: 2, lineNet: 20_000, unitCogsSnapshot: 6_000 }),
    makeLine({ product: turkish, quantity: 1, lineNet: 25_000, unitCogsSnapshot: 9_000 }),
  ];

  it('unitsSold totals quantity', () => {
    expect(unitsSold(lines)).toBe(6);
  });

  it('productMix aggregates and computes share', () => {
    const mix = productMix(lines);
    const esp = mix.find((m) => m.productId === 'esp')!;
    expect(esp.units).toBe(5);
    expect(esp.netSales).toBe(50_000);
    expect(esp.pct).toBeCloseTo(50_000 / 75_000, 6);
  });

  it('topProducts ranks by net sales', () => {
    expect(topProducts(lines, 1)[0].productId).toBe('esp');
  });

  it('slowMovers includes zero-selling catalog items', () => {
    const catalog = [
      { id: 'esp', sku: 'a', nameEn: 'Espresso', nameAr: '' },
      { id: 'tur', sku: 'b', nameEn: 'Turkish', nameAr: '' },
      { id: 'drip', sku: 'c', nameEn: 'Drip', nameAr: '' },
    ];
    const slow = slowMovers(lines, catalog, 1);
    expect(slow[0].productId).toBe('drip');
    expect(slow[0].units).toBe(0);
  });

  it('preferenceBy groups units by attribute', () => {
    const byGrind = preferenceBy(lines, 'grind');
    expect(byGrind.find((g) => g.key === 'ESPRESSO')!.units).toBe(5);
    expect(byGrind.find((g) => g.key === 'TURKISH')!.units).toBe(1);
  });
});
