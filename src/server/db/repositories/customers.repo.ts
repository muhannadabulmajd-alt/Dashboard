import 'server-only';
import { prisma } from '../client';
import type { CustomerLike } from '@/lib/metrics/types';
import { getOrderStatusRoleMap } from '@/server/lists/resolver';

type Scope = { branchId?: string };

export async function getCustomers(scope: Scope): Promise<CustomerLike[]> {
  const roles = await getOrderStatusRoleMap();
  const saleStatuses = [...roles].filter(([, role]) => role === 'SALE').map(([code]) => code);
  const orderWhere = { status: { in: saleStatuses }, ...(scope.branchId ? { branchId: scope.branchId } : {}) };
  const rows = await prisma.customer.findMany({
    where: scope.branchId ? { orders: { some: orderWhere } } : {},
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
    where: scope.branchId ? { branchId: scope.branchId } : {},
    select: { customerId: true, placedAt: true, status: true },
  });
  return orders.map((order) => ({ ...order, metricRole: roles.get(order.status) ?? 'UNKNOWN' }));
}
