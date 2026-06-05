import type { OrderStatus } from '@prisma/client';
import { bucketKey, bucketLabel } from '../dates';
import type {
  OrderLike,
  OrderLineLike,
  OrderLineWithProduct,
  DimensionBucket,
  TimePoint,
  ProductRank,
} from './types';

/** Orders that represent real sales (placed & paid). Cancelled/pending excluded. */
export function isSalesOrder(o: { status: OrderStatus }): boolean {
  return o.status !== 'CANCELLED' && o.status !== 'PENDING';
}

export function grossSales(orders: OrderLike[]): number {
  return orders.filter(isSalesOrder).reduce((s, o) => s + o.grossAmount, 0);
}

/** Net Sales = gross - discounts - refunds, over sales orders. */
export function netSales(orders: OrderLike[]): number {
  return orders
    .filter(isSalesOrder)
    .reduce((s, o) => s + (o.grossAmount - o.discountAmount - o.refundAmount), 0);
}

export function discountTotal(orders: OrderLike[]): number {
  return orders.filter(isSalesOrder).reduce((s, o) => s + o.discountAmount, 0);
}

export function refundTotal(orders: OrderLike[]): number {
  return orders.filter(isSalesOrder).reduce((s, o) => s + o.refundAmount, 0);
}

export function deliveryCostTotal(orders: OrderLike[]): number {
  return orders.filter(isSalesOrder).reduce((s, o) => s + o.deliveryCost, 0);
}

/** Completed (paid) order count. */
export function completedOrderCount(orders: OrderLike[]): number {
  return orders.filter((o) => o.status === 'COMPLETED').length;
}

export function unitsSold(lines: OrderLineLike[]): number {
  return lines.reduce((s, l) => s + l.quantity, 0);
}

export function aov(netSalesValue: number, orderCount: number): number {
  return orderCount > 0 ? netSalesValue / orderCount : 0;
}

export function avgUnitPrice(netSalesValue: number, units: number): number {
  return units > 0 ? netSalesValue / units : 0;
}

/** Discount spend and its effective rate vs. gross-of-discount sales. */
export function discountEffect(orders: OrderLike[]): {
  discountSpend: number;
  netSales: number;
  effectivePct: number;
} {
  const discountSpend = discountTotal(orders);
  const net = netSales(orders);
  const grossOfDiscount = net + discountSpend;
  return {
    discountSpend,
    netSales: net,
    effectivePct: grossOfDiscount > 0 ? discountSpend / grossOfDiscount : 0,
  };
}

/** Net sales / orders / units grouped by a single order dimension. */
export function salesByDimension<K extends 'channel' | 'governorate'>(
  orders: OrderLike[],
  key: K,
): DimensionBucket[] {
  const map = new Map<string, DimensionBucket>();
  for (const o of orders) {
    if (!isSalesOrder(o)) continue;
    const k = o[key] as string;
    const bucket = map.get(k) ?? { key: k, netSales: 0, orders: 0, units: 0 };
    bucket.netSales += o.grossAmount - o.discountAmount - o.refundAmount;
    bucket.orders += 1;
    map.set(k, bucket);
  }
  return [...map.values()].sort((a, b) => b.netSales - a.netSales);
}

/** Net sales / orders time series bucketed by Baghdad-local day or hour. */
export function salesTimeSeries(orders: OrderLike[], bucket: 'day' | 'hour'): TimePoint[] {
  const map = new Map<string, TimePoint>();
  for (const o of orders) {
    if (!isSalesOrder(o)) continue;
    const key = bucketKey(o.placedAt, bucket);
    const point = map.get(key) ?? { key, label: bucketLabel(key, bucket), netSales: 0, orders: 0 };
    point.netSales += o.grossAmount - o.discountAmount - o.refundAmount;
    point.orders += 1;
    map.set(key, point);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// --- Product-level breakdowns ----------------------------------------------

function rankFromLines(lines: OrderLineWithProduct[]): Map<string, ProductRank> {
  const map = new Map<string, ProductRank>();
  for (const l of lines) {
    const r =
      map.get(l.productId) ??
      ({
        productId: l.productId,
        sku: l.sku,
        name: { en: l.product.nameEn, ar: l.product.nameAr },
        units: 0,
        netSales: 0,
      } satisfies ProductRank);
    r.units += l.quantity;
    r.netSales += l.lineNet;
    map.set(l.productId, r);
  }
  return map;
}

export function productMix(
  lines: OrderLineWithProduct[],
): (ProductRank & { pct: number })[] {
  const ranks = [...rankFromLines(lines).values()];
  const total = ranks.reduce((s, r) => s + r.netSales, 0);
  return ranks
    .map((r) => ({ ...r, pct: total > 0 ? r.netSales / total : 0 }))
    .sort((a, b) => b.netSales - a.netSales);
}

export function topProducts(lines: OrderLineWithProduct[], n = 10): ProductRank[] {
  return [...rankFromLines(lines).values()]
    .sort((a, b) => b.netSales - a.netSales)
    .slice(0, n);
}

/** Slowest movers across the full active catalog (includes zero-sellers). */
export function slowMovers(
  lines: OrderLineWithProduct[],
  catalog: { id: string; sku: string; nameEn: string; nameAr: string }[],
  n = 10,
): ProductRank[] {
  const ranks = rankFromLines(lines);
  const rows: ProductRank[] = catalog.map(
    (p) =>
      ranks.get(p.id) ?? {
        productId: p.id,
        sku: p.sku,
        name: { en: p.nameEn, ar: p.nameAr },
        units: 0,
        netSales: 0,
      },
  );
  return rows.sort((a, b) => a.units - b.units || a.netSales - b.netSales).slice(0, n);
}

/** Units grouped by a product attribute (grind, sizeLabel). */
export function preferenceBy(
  lines: OrderLineWithProduct[],
  attr: 'grind' | 'sizeLabel',
): { key: string; units: number; pct: number }[] {
  const map = new Map<string, number>();
  let total = 0;
  for (const l of lines) {
    const k = String(l.product[attr]);
    map.set(k, (map.get(k) ?? 0) + l.quantity);
    total += l.quantity;
  }
  return [...map.entries()]
    .map(([key, units]) => ({ key, units, pct: total > 0 ? units / total : 0 }))
    .sort((a, b) => b.units - a.units);
}
