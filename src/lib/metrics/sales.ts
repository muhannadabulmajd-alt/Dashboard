import { bucketKey, bucketLabel } from '../dates';
import type {
  OrderLike,
  OrderLineLike,
  OrderLineWithProduct,
  DimensionBucket,
  TimePoint,
  ProductRank,
  OrderStatus,
} from './types';
import { isCompletedSaleStatus } from './status';

/** Orders that represent real sales (placed & paid). Cancelled/pending excluded. */
export function isSalesOrder(o: {
  status: OrderStatus;
  metricRole?: string;
  purpose?: string;
}): boolean {
  if (o.purpose && o.purpose !== 'SALE') return false;
  return o.metricRole ? o.metricRole === 'SALE' : isCompletedSaleStatus(o.status);
}

/** Largest-remainder integer allocation. Output always sums exactly to total. */
export function allocateInteger(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const clean = weights.map((weight) => Math.max(0, weight));
  const weightTotal = clean.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) return clean.map((_, index) => (index === clean.length - 1 ? total : 0));
  const exact = clean.map((weight) => total * weight / weightTotal);
  const result = exact.map(Math.floor);
  const remainder = total - result.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remainder; i++) result[order[i % order.length].index] += 1;
  return result;
}

export function grossSales(orders: OrderLike[]): number {
  return orders
    .filter(isSalesOrder)
    .reduce((s, o) => s + o.grossAmount + o.deliveryFee + (o.extraCharges ?? 0), 0);
}

/** Net sales equals the completed customer invoice revenue. */
export function netSales(orders: OrderLike[]): number {
  return orders
    .filter(isSalesOrder)
    .reduce(
      (s, o) =>
        s +
        Math.max(
          0,
          o.grossAmount -
            o.discountAmount -
            o.refundAmount +
            o.deliveryFee +
            (o.extraCharges ?? 0),
        ),
      0,
    );
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

/** Count of statuses explicitly mapped as completed sales. */
export function completedOrderCount(orders: OrderLike[]): number {
  return orders.filter(isSalesOrder).length;
}

/**
 * Count of real sales orders (placed & not cancelled/pending) — the same
 * population netSales is computed over, so it's the correct denominator for AOV
 * and the headline "Orders" count, and it reconciles with per-dimension counts.
 */
export function salesOrderCount(orders: OrderLike[]): number {
  return orders.filter(isSalesOrder).length;
}

/** Share of sales orders that completed (vs returned/refunded). 0..1. */
export function orderCompletionRate(orders: OrderLike[]): number {
  const sales = salesOrderCount(orders);
  return sales > 0 ? completedOrderCount(orders) / sales : 0;
}

export function unitsSold(lines: OrderLineLike[]): number {
  return lines.reduce((s, l) => s + l.quantity, 0);
}

export function aov(netSalesValue: number, orderCount: number): number {
  return orderCount > 0 ? netSalesValue / orderCount : 0;
}

export function averageOrdersPerDay(
  orders: OrderLike[],
  range: { start: Date; end: Date },
): number {
  const sales = orders.filter(isSalesOrder);
  if (!sales.length) return 0;
  const firstSale = sales.reduce((min, order) => (order.placedAt < min ? order.placedAt : min), sales[0].placedAt);
  const start = range.start.getFullYear() <= 2000 ? firstSale : range.start;
  const days = Math.max(1, Math.ceil((range.end.getTime() - start.getTime()) / 86_400_000));
  return sales.length / days;
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
    bucket.netSales += Math.max(
      0,
      o.grossAmount -
        o.discountAmount -
        o.refundAmount +
        o.deliveryFee +
        (o.extraCharges ?? 0),
    );
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
    point.netSales += Math.max(
      0,
      o.grossAmount -
        o.discountAmount -
        o.refundAmount +
        o.deliveryFee +
        (o.extraCharges ?? 0),
    );
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

/**
 * Net sales + units rolled up to the parent product group (variations module).
 * Ungrouped products are reported as their own parent so totals reconcile.
 */
export function salesByGroup(
  lines: OrderLineWithProduct[],
): { key: string; nameEn: string; nameAr: string; netSales: number; units: number }[] {
  const map = new Map<string, { nameEn: string; nameAr: string; netSales: number; units: number }>();
  for (const l of lines) {
    const p = l.product;
    const key = p.groupId ?? `prod:${p.id}`;
    const entry = map.get(key) ?? {
      nameEn: p.group?.nameEn ?? p.nameEn,
      nameAr: p.group?.nameAr ?? p.nameAr,
      netSales: 0,
      units: 0,
    };
    entry.netSales += l.lineNet;
    entry.units += l.quantity;
    map.set(key, entry);
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.netSales - a.netSales);
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
