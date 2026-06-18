import 'server-only';
import { prisma } from '../client';
import { buildOrderWhere, buildOrderLineWhere } from '@/server/filters/where-builder';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';
import type { OrderLike, OrderLineWithProduct } from '@/lib/metrics/types';
import { allocateInteger } from '@/lib/metrics/sales';
import type { Prisma } from '@prisma/client';
import { getOrderStatusRoleMap } from '@/server/lists/resolver';

type Scope = { branchId?: string };

const orderSelect = {
  id: true,
  branchId: true,
  offerId: true,
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
type SelectedLine = Prisma.OrderLineGetPayload<{ select: typeof lineSelect }>;

const lineSelect = {
  id: true,
  productId: true,
  sku: true,
  quantity: true,
  unitGrossPrice: true,
  lineDiscount: true,
  lineNet: true,
  unitCogsSnapshot: true,
  order: {
    select: {
      id: true,
      branchId: true,
      offerId: true,
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
      lines: { select: { id: true, lineNet: true }, orderBy: { id: 'asc' as const } },
    },
  },
  product: {
    select: {
      id: true,
      sku: true,
      nameEn: true,
      nameAr: true,
      productLine: true,
      grind: true,
      sizeLabel: true,
      groupId: true,
      group: { select: { nameEn: true, nameAr: true } },
    },
  },
} as const;

function hasProductFilter(filters: DashboardFilters): boolean {
  return Boolean(filters.sku?.length || filters.productLine?.length || filters.grind?.length || filters.roastLevel?.length);
}

function allocatedNet(row: SelectedLine): number {
  const orderLines = row.order.lines;
  const orderNet = Math.max(0, row.order.grossAmount - row.order.discountAmount - row.order.refundAmount);
  const allocations = allocateInteger(orderNet, orderLines.map((line) => line.lineNet));
  const index = orderLines.findIndex((line) => line.id === row.id);
  return index >= 0 ? allocations[index] : 0;
}

async function loadOrderLines(filters: DashboardFilters, scope: Scope, range: ResolvedRange) {
  const roles = await getOrderStatusRoleMap();
  const saleStatuses = [...roles].filter(([, role]) => role === 'SALE').map(([code]) => code);
  return prisma.orderLine.findMany({ where: buildOrderLineWhere(filters, scope, range, saleStatuses), select: lineSelect });
}

export async function getOrders(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<OrderLike[]> {
  const roles = await getOrderStatusRoleMap();
  if (hasProductFilter(filters)) {
    const lines = await loadOrderLines(filters, scope, range);
    const byOrder = new Map<string, OrderLike>();
    for (const line of lines) {
      const allocated = allocatedNet(line);
      const existing = byOrder.get(line.order.id);
      if (existing) {
        existing.grossAmount += line.unitGrossPrice * line.quantity;
        existing.discountAmount += line.unitGrossPrice * line.quantity - allocated;
        continue;
      }
      byOrder.set(line.order.id, {
        ...line.order,
        metricRole: roles.get(line.order.status) ?? 'UNKNOWN',
        grossAmount: line.unitGrossPrice * line.quantity,
        discountAmount: line.unitGrossPrice * line.quantity - allocated,
        refundAmount: 0,
      });
    }
    return [...byOrder.values()];
  }
  const orders = await prisma.order.findMany({ where: buildOrderWhere(filters, scope, range), select: orderSelect });
  return orders.map((order) => ({ ...order, metricRole: roles.get(order.status) ?? 'UNKNOWN' }));
}

/** Orders from the previous comparable window (for period-over-period deltas). */
export async function getPrevOrders(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<OrderLike[]> {
  if (!range.prevStart || !range.prevEnd) return [];
  const prevRange: ResolvedRange = { start: range.prevStart, end: range.prevEnd };
  return getOrders(filters, scope, prevRange);
}

export async function getOrderLines(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<OrderLineWithProduct[]> {
  const rows = await loadOrderLines(filters, scope, range);
  return rows.map((row) => ({
    productId: row.productId,
    orderId: row.order.id,
    branchId: row.order.branchId,
    customerId: row.order.customerId,
    sku: row.sku,
    quantity: row.quantity,
    unitGrossPrice: row.unitGrossPrice,
    lineDiscount: row.lineDiscount,
    lineNet: allocatedNet(row),
    unitCogsSnapshot: row.unitCogsSnapshot,
    product: row.product,
  }));
}

export async function getActiveCatalog(): Promise<
  { id: string; sku: string; nameEn: string; nameAr: string }[]
> {
  return prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, sku: true, nameEn: true, nameAr: true },
  });
}

/** Active catalog with price + cost for margin-health alerts (§9/§17). */
export async function getCatalogForAlerts(): Promise<
  { id: string; nameEn: string; nameAr: string; sellingPrice: number; cogsPerUnit: number }[]
> {
  return prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, nameEn: true, nameAr: true, sellingPrice: true, cogsPerUnit: true },
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

/** Latest meaningful operational activity, not merely the latest sales import. */
export async function getLatestActivityDate(scope: Scope): Promise<Date | null> {
  const branch = scope.branchId ? { branchId: scope.branchId } : {};
  const [order, finance, movement, batch] = await Promise.all([
    prisma.order.findFirst({ where: branch, orderBy: { placedAt: 'desc' }, select: { placedAt: true } }),
    prisma.financeEntry.findFirst({
      where: { ...branch, archivedAt: null, reversedAt: null, reversalOfId: null },
      orderBy: { date: 'desc' },
      select: { date: true },
    }),
    prisma.stockMovement.findFirst({ where: branch, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
    prisma.roastBatch.findFirst({ where: branch, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);
  const dates = [order?.placedAt, finance?.date, movement?.occurredAt, batch?.createdAt].filter((value): value is Date => Boolean(value));
  return dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null;
}
