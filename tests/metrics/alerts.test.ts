import { describe, it, expect } from 'vitest';
import { buildAlerts, alertCounts } from '@/lib/metrics/alerts';

const stock = [
  { id: 'out', nameEn: 'Out', nameAr: 'نفد', unit: 'kg', current: 0, reorderPoint: 5 },
  { id: 'low', nameEn: 'Low', nameAr: 'منخفض', unit: 'kg', current: 3, reorderPoint: 5 },
  { id: 'ok', nameEn: 'OK', nameAr: 'جيد', unit: 'kg', current: 50, reorderPoint: 5 },
  { id: 'untracked', nameEn: 'Untracked', nameAr: 'غير متتبع', unit: 'kg', current: 1, reorderPoint: null },
];
const expiring = [
  { id: 'soon', nameEn: 'Soon', nameAr: 'قريباً', daysToExpiry: 4 },
  { id: 'expired', nameEn: 'Expired', nameAr: 'منتهٍ', daysToExpiry: -2 },
];
const products = [
  { id: 'loss', nameEn: 'Loss', nameAr: 'خسارة', sellingPrice: 8_000, cogsPerUnit: 9_000 }, // below cost
  { id: 'thin', nameEn: 'Thin', nameAr: 'هامش رفيع', sellingPrice: 8_000, cogsPerUnit: 7_500 }, // ~6% < 15%
  { id: 'healthy', nameEn: 'Healthy', nameAr: 'صحي', sellingPrice: 8_000, cogsPerUnit: 4_000 }, // ok
];

describe('alerts engine (§9/§17)', () => {
  it('classifies stockouts (critical) vs reorder (warning) and ignores healthy/untracked', () => {
    const a = buildAlerts({ stock, expiring: [], products: [] });
    expect(a.map((x) => x.refId)).toEqual(['out', 'low']);
    expect(a.find((x) => x.refId === 'out')!.kind).toBe('stockout');
    expect(a.find((x) => x.refId === 'out')!.severity).toBe('critical');
    expect(a.find((x) => x.refId === 'low')!.kind).toBe('reorder');
    expect(a.find((x) => x.refId === 'low')!.severity).toBe('warning');
  });

  it('escalates expired lots to critical, near-expiry stays warning', () => {
    const a = buildAlerts({ stock: [], expiring, products: [] });
    expect(a.find((x) => x.refId === 'expired')!.severity).toBe('critical');
    expect(a.find((x) => x.refId === 'soon')!.severity).toBe('warning');
  });

  it('flags below-cost (critical) and low-margin (warning) products with a margin ratio', () => {
    const a = buildAlerts({ stock: [], expiring: [], products });
    const loss = a.find((x) => x.refId === 'loss')!;
    const thin = a.find((x) => x.refId === 'thin')!;
    expect(a.some((x) => x.refId === 'healthy')).toBe(false);
    expect(loss.kind).toBe('belowCost');
    expect(loss.severity).toBe('critical');
    expect(loss.value).toBeCloseTo((8_000 - 9_000) / 8_000, 6); // negative
    expect(thin.kind).toBe('lowMargin');
    expect(thin.value).toBeCloseTo(500 / 8_000, 6);
  });

  it('ranks critical before warning across categories', () => {
    const a = buildAlerts({ stock, expiring, products });
    const firstWarning = a.findIndex((x) => x.severity === 'warning');
    const lastCritical = a.map((x) => x.severity).lastIndexOf('critical');
    expect(lastCritical).toBeLessThan(firstWarning);
  });

  it('alertCounts tallies severities', () => {
    const a = buildAlerts({ stock, expiring, products });
    const c = alertCounts(a);
    expect(c.total).toBe(a.length);
    expect(c.critical + c.warning).toBe(c.total);
    // out (stockout) + expired + loss = 3 critical
    expect(c.critical).toBe(3);
  });
});
