import 'server-only';
import { prisma } from '../client';
import type { CustomerLike } from '@/lib/metrics/types';

type Scope = { branchId?: string };

export async function getCustomers(scope: Scope): Promise<CustomerLike[]> {
  return prisma.customer.findMany({
    where: scope.branchId ? { orders: { some: { branchId: scope.branchId } } } : {},
    select: {
      id: true,
      governorate: true,
      segment: true,
      firstOrderAt: true,
      lastOrderAt: true,
      ordersCount: true,
    },
  });
}

/** Minimal all-time order history (branch-scoped) for cohort + conversion analysis. */
export async function getOrderHistory(
  scope: Scope,
): Promise<{ customerId: string | null; placedAt: Date; status: string }[]> {
  return prisma.order.findMany({
    where: scope.branchId ? { branchId: scope.branchId } : {},
    select: { customerId: true, placedAt: true, status: true },
  });
}
