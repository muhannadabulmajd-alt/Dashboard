import 'server-only';
import { prisma } from '../client';
import { buildOrderWhere, buildOrderLineWhere } from '@/server/filters/where-builder';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';
import type { OrderLike, OrderLineWithProduct } from '@/lib/metrics/types';

type Scope = { branchId?: string };

const orderSelect = {
  id: true,
  placedAt: true,
  status: true,
  channel: true,
  governorate: true,
  customerId: true,
  currency: true,
  grossAmount: true,
  discountAmount: true,
  refundAmount: true,
  deliveryFee: true,
  deliveryCost: true,
} as const;

const lineSelect = {
  productId: true,
  sku: true,
  quantity: true,
  unitGrossPrice: true,
  lineDiscount: true,
  lineNet: true,
  unitCogsSnapshot: true,
  product: {
    select: {
      id: true,
      sku: true,
      nameEn: true,
      nameAr: true,
      productLine: true,
      grind: true,
      sizeLabel: true,
    },
  },
} as const;

export async function getOrders(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<OrderLike[]> {
  return prisma.order.findMany({ where: buildOrderWhere(filters, scope, range), select: orderSelect });
}

/** Orders from the previous comparable window (for period-over-period deltas). */
export async function getPrevOrders(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<OrderLike[]> {
  if (!range.prevStart || !range.prevEnd) return [];
  const prevRange: ResolvedRange = { start: range.prevStart, end: range.prevEnd };
  return prisma.order.findMany({
    where: buildOrderWhere(filters, scope, prevRange),
    select: orderSelect,
  });
}

export async function getOrderLines(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<OrderLineWithProduct[]> {
  return prisma.orderLine.findMany({
    where: buildOrderLineWhere(filters, scope, range),
    select: lineSelect,
  });
}

export async function getActiveCatalog(): Promise<
  { id: string; sku: string; nameEn: string; nameAr: string }[]
> {
  return prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, sku: true, nameEn: true, nameAr: true },
  });
}

/** Latest order timestamp — drives the data-freshness banner. */
export async function getLatestOrderDate(scope: Scope): Promise<Date | null> {
  const row = await prisma.order.findFirst({
    where: scope.branchId ? { branchId: scope.branchId } : {},
    orderBy: { placedAt: 'desc' },
    select: { placedAt: true },
  });
  return row?.placedAt ?? null;
}
