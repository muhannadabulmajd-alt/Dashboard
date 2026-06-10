import type { CustomerSegment } from '@prisma/client';
import type { OrderLike, CustomerLike, OrderStatus } from './types';
import { isSalesOrder } from './sales';

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}
function addMonthKey(key: string, offset: number): string {
  const [y, m] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function uniqueActiveCustomers(orders: OrderLike[]): number {
  const set = new Set<string>();
  for (const o of orders) if (isSalesOrder(o) && o.customerId) set.add(o.customerId);
  return set.size;
}

export interface NewReturning {
  newCount: number;
  returning: number;
  total: number;
}

/** Classify customers active in the window as new (first order within it) vs returning. */
export function classifyNewReturning(
  orders: OrderLike[],
  firstOrderById: Map<string, Date | null>,
  start: Date,
  end: Date,
): NewReturning {
  const active = new Set<string>();
  for (const o of orders) if (isSalesOrder(o) && o.customerId) active.add(o.customerId);
  let newCount = 0;
  for (const id of active) {
    const first = firstOrderById.get(id) ?? null;
    if (first && first >= start && first <= end) newCount += 1;
  }
  return { newCount, returning: active.size - newCount, total: active.size };
}

export function repeatPurchaseRate(nr: NewReturning): number {
  return nr.total > 0 ? nr.returning / nr.total : 0;
}

export function frequencySegmentCounts(
  customers: CustomerLike[],
): { segment: CustomerSegment; count: number }[] {
  const map = new Map<CustomerSegment, number>();
  for (const c of customers) map.set(c.segment, (map.get(c.segment) ?? 0) + 1);
  return [...map.entries()]
    .map(([segment, count]) => ({ segment, count }))
    .sort((a, b) => b.count - a.count);
}

/** Share of customers whose first order is in the window who reorder within `windowDays`. */
export function firstToSecondConversion(
  orders: { customerId: string | null; placedAt: Date; status: OrderStatus }[],
  start: Date,
  end: Date,
  windowDays: number,
): number {
  const byCustomer = new Map<string, Date[]>();
  for (const o of orders) {
    if (o.status === 'CANCELLED' || o.status === 'PENDING' || !o.customerId) continue;
    const arr = byCustomer.get(o.customerId) ?? [];
    arr.push(o.placedAt);
    byCustomer.set(o.customerId, arr);
  }
  let cohort = 0;
  let converted = 0;
  const windowMs = windowDays * 86_400_000;
  for (const dates of byCustomer.values()) {
    dates.sort((a, b) => a.getTime() - b.getTime());
    const first = dates[0];
    if (first >= start && first <= end) {
      cohort += 1;
      if (dates.length > 1 && dates[1].getTime() - first.getTime() <= windowMs) converted += 1;
    }
  }
  return cohort > 0 ? converted / cohort : 0;
}

export interface CohortRow {
  cohort: string;
  size: number;
  retention: number[]; // index 0 = acquisition month (1.0)
}

/** Monthly cohort retention from full order history (ignores the date filter). */
export function cohortRetention(
  orders: { customerId: string | null; placedAt: Date; status: OrderStatus }[],
  maxMonths = 6,
): CohortRow[] {
  const firstByCust = new Map<string, Date>();
  const activeMonths = new Map<string, Set<string>>();
  for (const o of orders) {
    if (o.status === 'CANCELLED' || o.status === 'PENDING' || !o.customerId) continue;
    const cur = firstByCust.get(o.customerId);
    if (!cur || o.placedAt < cur) firstByCust.set(o.customerId, o.placedAt);
    const set = activeMonths.get(o.customerId) ?? new Set<string>();
    set.add(monthKey(o.placedAt));
    activeMonths.set(o.customerId, set);
  }
  const cohorts = new Map<string, string[]>();
  for (const [cust, first] of firstByCust) {
    const k = monthKey(first);
    const arr = cohorts.get(k) ?? [];
    arr.push(cust);
    cohorts.set(k, arr);
  }
  return [...cohorts.keys()]
    .sort()
    .map((ck) => {
      const members = cohorts.get(ck)!;
      const size = members.length;
      const retention: number[] = [];
      for (let off = 0; off < maxMonths; off++) {
        const target = addMonthKey(ck, off);
        let active = 0;
        for (const cust of members) if (activeMonths.get(cust)?.has(target)) active += 1;
        retention.push(size > 0 ? active / size : 0);
      }
      return { cohort: ck, size, retention };
    });
}

export function customersByCity(
  customers: CustomerLike[],
): { governorate: string; count: number }[] {
  const map = new Map<string, number>();
  for (const c of customers) {
    if (c.governorate && c.ordersCount > 0) map.set(c.governorate, (map.get(c.governorate) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([governorate, count]) => ({ governorate, count }))
    .sort((a, b) => b.count - a.count);
}
