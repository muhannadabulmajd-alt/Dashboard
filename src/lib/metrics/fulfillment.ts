import type { OrderLike, ShipmentLike } from './types';
import { isSalesOrder } from './sales';
import { isReturnStatus } from './status';

const DAY = 86_400_000;

/** Delivery duration in days (dispatch → delivered), or null if not delivered. */
export function deliveryDays(s: ShipmentLike): number | null {
  if (s.status !== 'DELIVERED' || !s.deliveredAt) return null;
  const from = s.dispatchedAt ?? s.placedAt;
  return (s.deliveredAt.getTime() - from.getTime()) / DAY;
}

export function avgDeliveryDays(shipments: ShipmentLike[]): number {
  const ds = shipments.map(deliveryDays).filter((d): d is number => d != null);
  return ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0;
}

/** On-time deliveries (within SLA) / total delivered. */
export function deliverySlaPct(shipments: ShipmentLike[], slaDays = 3): number {
  const delivered = shipments.filter((s) => s.status === 'DELIVERED' && s.deliveredAt);
  if (!delivered.length) return 0;
  const onTime = delivered.filter((s) => (deliveryDays(s) ?? Infinity) <= slaDays).length;
  return onTime / delivered.length;
}

const isFailed = (s: ShipmentLike) => s.status === 'FAILED' || s.status === 'RETURNED';

/** Count of failed/returned shipments. */
export function failedDeliveryCount(shipments: ShipmentLike[]): number {
  return shipments.filter(isFailed).length;
}

export function failedDeliveryRate(shipments: ShipmentLike[]): number {
  if (!shipments.length) return 0;
  return failedDeliveryCount(shipments) / shipments.length;
}

/** Returned/refunded orders ÷ sales orders. */
export function returnRate(orders: OrderLike[]): number {
  const completed = orders.filter(isSalesOrder).length;
  const returned = orders.filter((order) =>
    order.metricRole ? order.metricRole === 'RETURN' : isReturnStatus(order.status),
  ).length;
  const resolved = completed + returned;
  return resolved > 0 ? returned / resolved : 0;
}

export function avgShippingCost(shipments: ShipmentLike[]): number {
  if (!shipments.length) return 0;
  return shipments.reduce((s, x) => s + x.shippingCost, 0) / shipments.length;
}

export interface CourierStat {
  courier: string;
  shipments: number;
  delivered: number;
  failed: number;
  slaPct: number;
  avgDays: number;
  avgCost: number;
}

export function courierComparison(shipments: ShipmentLike[]): CourierStat[] {
  const groups = new Map<string, ShipmentLike[]>();
  for (const s of shipments) {
    const arr = groups.get(s.courier) ?? [];
    arr.push(s);
    groups.set(s.courier, arr);
  }
  return [...groups.entries()]
    .map(([courier, list]) => ({
      courier,
      shipments: list.length,
      delivered: list.filter((s) => s.status === 'DELIVERED').length,
      failed: list.filter(isFailed).length,
      slaPct: deliverySlaPct(list),
      avgDays: avgDeliveryDays(list),
      avgCost: avgShippingCost(list),
    }))
    .sort((a, b) => b.shipments - a.shipments);
}

export function cityDeliveryPerformance(
  shipments: ShipmentLike[],
): { governorate: string; shipments: number; slaPct: number; avgDays: number }[] {
  const groups = new Map<string, ShipmentLike[]>();
  for (const s of shipments) {
    const arr = groups.get(s.governorate) ?? [];
    arr.push(s);
    groups.set(s.governorate, arr);
  }
  return [...groups.entries()]
    .map(([governorate, list]) => ({
      governorate,
      shipments: list.length,
      slaPct: deliverySlaPct(list),
      avgDays: avgDeliveryDays(list),
    }))
    .sort((a, b) => b.shipments - a.shipments);
}
