import 'server-only';
import { prisma } from '../client';
import { getOrders } from './sales.repo';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';
import type { OfferOrderLike } from '@/lib/metrics/types';

type Scope = { branchId?: string };

export async function getOffers(): Promise<{ id: string; name: string; code: string | null; startsAt: Date | null; endsAt: Date | null }[]> {
  return prisma.offer.findMany({ select: { id: true, name: true, code: true, startsAt: true, endsAt: true } });
}

export async function getOfferOrders(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<OfferOrderLike[]> {
  const orders = await getOrders(filters, scope, range);
  return orders.filter((order) => order.offerId != null).map((order) => ({
    offerId: order.offerId ?? null,
    customerId: order.customerId,
    status: order.status,
    metricRole: order.metricRole,
    grossAmount: order.grossAmount,
    discountAmount: order.discountAmount,
    refundAmount: order.refundAmount,
  }));
}
