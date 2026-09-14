import 'server-only';
import { prisma } from '../client';
import type { CustomerLike } from '@/lib/metrics/types';
import { getOrderStatusRoleMap } from '@/server/lists/resolver';
import { buildOrderScopeWhere, type DataScope } from '@/server/filters/where-builder';

type Scope = DataScope;

export async function getCustomers(scope: Scope): Promise<CustomerLike[]> {
  const roles = await getOrderStatusRoleMap();
  const saleStatuses = [...roles].filter(([, role]) => role === 'SALE').map(([code]) => code);
  const orderWhere = {
    status: { in: saleStatuses },
    purpose: 'SALE' as const,
    ...buildOrderScopeWhere(scope),
  };
  const isRestricted = scope.locationIds !== undefined || Boolean(scope.branchId);
  const rows = await prisma.customer.findMany({
    where: isRestricted ? { orders: { some: orderWhere } } : {},
    select: {
      id: true,
      governorate: true,
      segment: true,
      firstOrderAt: true,
      lastOrderAt: true,
      ordersCount: true,
      orders: { where: orderWhere, select: { placedAt: true }, orderBy: { placedAt: 'asc' } },
    },
  });
  return rows.map(({ orders, ...customer }) => ({
    ...customer,
    ordersCount: orders.length,
    firstOrderAt: orders[0]?.placedAt ?? null,
    lastOrderAt: orders.at(-1)?.placedAt ?? null,
  }));
}

/** Minimal all-time order history (branch-scoped) for cohort + conversion analysis. */
export async function getOrderHistory(
  scope: Scope,
): Promise<{ customerId: string | null; placedAt: Date; status: string; metricRole: string }[]> {
  const roles = await getOrderStatusRoleMap();
  const orders = await prisma.order.findMany({
    where: buildOrderScopeWhere(scope),
    select: { customerId: true, placedAt: true, status: true },
  });
  return orders.map((order) => ({ ...order, metricRole: roles.get(order.status) ?? 'UNKNOWN' }));
}
