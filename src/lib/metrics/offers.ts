import type { OfferOrderLike } from './types';
import { isSalesOrder } from './sales';

export interface OfferStat {
  offerId: string;
  orders: number;
  revenue: number;
  discountSpend: number;
  newCustomers: number;
  aov: number;
}

/** Per-offer performance over the supplied (filtered) orders. */
export function offerPerformance(
  orders: OfferOrderLike[],
  firstOrderById: Map<string, Date | null>,
  start: Date,
  end: Date,
): OfferStat[] {
  const map = new Map<
    string,
    { orders: number; revenue: number; discount: number; newCusts: Set<string> }
  >();
  for (const o of orders) {
    if (!o.offerId || !isSalesOrder(o)) continue;
    const e = map.get(o.offerId) ?? { orders: 0, revenue: 0, discount: 0, newCusts: new Set<string>() };
    e.orders += 1;
    e.revenue += o.grossAmount - o.discountAmount - o.refundAmount;
    e.discount += o.discountAmount;
    if (o.customerId) {
      const first = firstOrderById.get(o.customerId);
      if (first && first >= start && first <= end) e.newCusts.add(o.customerId);
    }
    map.set(o.offerId, e);
  }
  return [...map.entries()]
    .map(([offerId, e]) => ({
      offerId,
      orders: e.orders,
      revenue: e.revenue,
      discountSpend: e.discount,
      newCustomers: e.newCusts.size,
      aov: e.orders > 0 ? e.revenue / e.orders : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}
