import 'server-only';
import { prisma } from '../client';
import { buildOrderWhere } from '@/server/filters/where-builder';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';
import type { ShipmentLike } from '@/lib/metrics/types';

type Scope = { branchId?: string };

export async function getShipments(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<ShipmentLike[]> {
  const rows = await prisma.shipment.findMany({
    where: { order: buildOrderWhere(filters, scope, range) },
    select: {
      status: true,
      dispatchedAt: true,
      deliveredAt: true,
      shippingCost: true,
      courier: true,
      governorate: true,
      order: { select: { placedAt: true } },
    },
  });
  return rows.map((r) => ({
    status: r.status,
    dispatchedAt: r.dispatchedAt,
    deliveredAt: r.deliveredAt,
    shippingCost: r.shippingCost,
    courier: r.courier,
    governorate: r.governorate,
    placedAt: r.order.placedAt,
  }));
}
