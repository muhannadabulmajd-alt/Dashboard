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
} from '@/lib/metrics/sales';
import { makeOrder, makeLine, makeProduct } from '../fixtures/builders';

describe('sales metrics', () => {
  const orders = [
    makeOrder({ grossAmount: 100_000, discountAmount: 10_000, status: 'COMPLETED', channel: 'ONLINE_STORE' }),
    makeOrder({ grossAmount: 50_000, discountAmount: 0, status: 'COMPLETED', channel: 'POS' }),
    makeOrder({ grossAmount: 30_000, status: 'CANCELLED' }), // excluded everywhere
    makeOrder({ grossAmount: 40_000, refundAmount: 40_000, status: 'RETURNED', channel: 'ONLINE_STORE' }),
  ];

  it('grossSales excludes cancelled orders', () => {
    expect(grossSales(orders)).toBe(190_000); // 100k + 50k + 40k
  });

  it('netSales subtracts discounts and refunds', () => {
    expect(netSales(orders)).toBe(140_000); // 90k + 50k + 0
  });

  it('discountTotal sums discounts of sales orders', () => {
    expect(discountTotal(orders)).toBe(10_000);
  });

  it('completedOrderCount counts only COMPLETED', () => {
    expect(completedOrderCount(orders)).toBe(2);
  });

  it('salesOrderCount counts all real sales orders (incl. returned), excludes cancelled', () => {
    expect(salesOrderCount(orders)).toBe(3); // 2 completed + 1 returned; cancelled excluded
  });

  it('orderCompletionRate = completed / sales orders', () => {
    expect(orderCompletionRate(orders)).toBeCloseTo(2 / 3, 6);
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
    expect(online.netSales).toBe(90_000); // 90k + 0
    expect(online.orders).toBe(2);
    expect(pos.netSales).toBe(50_000);
    // sorted descending by net sales
    expect(byChannel[0].key).toBe('ONLINE_STORE');
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
