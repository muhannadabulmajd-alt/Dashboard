import 'server-only';
import { prisma } from '../client';
import { buildOrderWhere } from '@/server/filters/where-builder';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';
import type { OfferOrderLike } from '@/lib/metrics/types';

type Scope = { branchId?: string };

export async function getOffers(): Promise<{ id: string; name: string; code: string | null }[]> {
  return prisma.offer.findMany({ select: { id: true, name: true, code: true } });
}

export async function getOfferOrders(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<OfferOrderLike[]> {
  return prisma.order.findMany({
    where: { ...buildOrderWhere(filters, scope, range), offerId: { not: null } },
    select: {
      offerId: true,
      customerId: true,
      status: true,
      grossAmount: true,
      discountAmount: true,
      refundAmount: true,
    },
  });
}
