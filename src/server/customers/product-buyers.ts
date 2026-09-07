import 'server-only';
import type { Customer } from '@prisma/client';
import type { ResolvedRange } from '@/lib/dates';
import type { DashboardFilters } from '@/lib/filters';
import type { OrderLike, OrderLineWithProduct } from '@/lib/metrics/types';
import { prisma } from '@/server/db/client';
import { getOrderLines, getOrders } from '@/server/db/repositories/sales.repo';
import { matchReportingProduct } from '@/server/products/matching';

type Scope = { branchId?: string };

export type ProductBuyerRow = {
  customerId: string;
  externalId: string | null;
  nameEn: string | null;
  nameAr: string | null;
  phone: string | null;
  governorate: string | null;
  orders: number;
  units: number;
  itemSales: number;
  firstPurchaseAt: Date;
  lastPurchaseAt: Date;
};

type BuyerCustomer = Pick<Customer, 'id' | 'externalId' | 'nameEn' | 'nameAr' | 'phone' | 'governorate'>;

export function aggregateProductBuyers(
  orders: OrderLike[],
  lines: OrderLineWithProduct[],
  customers: BuyerCustomer[],
): {
  buyers: ProductBuyerRow[];
  orderCount: number;
  units: number;
  itemSales: number;
  guestOrderCount: number;
} {
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  const byCustomer = new Map<string, {
    orderIds: Set<string>;
    units: number;
    itemSales: number;
    firstPurchaseAt: Date;
    lastPurchaseAt: Date;
  }>();
  const guestOrderIds = new Set<string>();
  let units = 0;
  let itemSales = 0;

  for (const line of lines) {
    if (!line.orderId) continue;
    const order = ordersById.get(line.orderId);
    if (!order) continue;
    units += line.quantity;
    itemSales += line.lineNet;
    if (!order.customerId) {
      guestOrderIds.add(order.id);
      continue;
    }
    const existing = byCustomer.get(order.customerId);
    if (existing) {
      existing.orderIds.add(order.id);
      existing.units += line.quantity;
      existing.itemSales += line.lineNet;
      if (order.placedAt < existing.firstPurchaseAt) existing.firstPurchaseAt = order.placedAt;
      if (order.placedAt > existing.lastPurchaseAt) existing.lastPurchaseAt = order.placedAt;
      continue;
    }
    byCustomer.set(order.customerId, {
      orderIds: new Set([order.id]),
      units: line.quantity,
      itemSales: line.lineNet,
      firstPurchaseAt: order.placedAt,
      lastPurchaseAt: order.placedAt,
    });
  }

  const buyers = [...byCustomer].flatMap(([customerId, totals]) => {
    const customer = customersById.get(customerId);
    if (!customer) return [];
    return [{
      customerId,
      externalId: customer.externalId,
      nameEn: customer.nameEn,
      nameAr: customer.nameAr,
      phone: customer.phone,
      governorate: customer.governorate,
      orders: totals.orderIds.size,
      units: totals.units,
      itemSales: totals.itemSales,
      firstPurchaseAt: totals.firstPurchaseAt,
      lastPurchaseAt: totals.lastPurchaseAt,
    }];
  }).sort((left, right) =>
    right.itemSales - left.itemSales ||
    right.orders - left.orders ||
    right.lastPurchaseAt.getTime() - left.lastPurchaseAt.getTime(),
  );

  return {
    buyers,
    orderCount: orders.length,
    units,
    itemSales,
    guestOrderCount: guestOrderIds.size,
  };
}

export async function findProductBuyers(input: {
  productQuery: string;
  filters: DashboardFilters;
  scope: Scope;
  range: ResolvedRange;
}) {
  const match = await matchReportingProduct(input.productQuery);
  if (match.kind !== 'exact') return match;

  const filters: DashboardFilters = { ...input.filters, sku: [match.value.sku] };
  const [orders, lines] = await Promise.all([
    getOrders(filters, input.scope, input.range),
    getOrderLines(filters, input.scope, input.range),
  ]);
  const customerIds = [...new Set(orders.map((order) => order.customerId).filter((id): id is string => Boolean(id)))];
  const customers = customerIds.length
    ? await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: {
          id: true,
          externalId: true,
          nameEn: true,
          nameAr: true,
          phone: true,
          governorate: true,
        },
      })
    : [];

  return {
    kind: 'exact' as const,
    product: match.value,
    ...aggregateProductBuyers(orders, lines, customers),
  };
}
