import 'server-only';
import { prisma } from '../client';
import { getOrderLines, getOrders } from './sales.repo';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';
import { netSales } from '@/lib/metrics';

type Scope = { branchId?: string };

export interface BranchPerf {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  isFranchise: boolean;
  netSales: number;
  cogs: number;
  marginPct: number;
  units: number;
  orders: number;
  customers: number;
}

/** Per-branch economics over the filtered period (branch-scoped for franchisees). */
export async function getBranchPerformance(
  filters: DashboardFilters,
  scope: Scope,
  range: ResolvedRange,
): Promise<BranchPerf[]> {
  const branches = await prisma.branch.findMany({
    where: {
      isActive: true,
      ...(scope.branchId
        ? { id: scope.branchId }
        : filters.branchId?.length
          ? { id: { in: filters.branchId } }
          : {}),
    },
    select: { id: true, code: true, nameEn: true, nameAr: true, isFranchise: true },
  });

  const [orders, lines] = await Promise.all([
    getOrders(filters, scope, range),
    getOrderLines(filters, scope, range),
  ]);

  const agg = new Map<
    string,
    { net: number; cogs: number; units: number; orders: Set<string>; customers: Set<string> }
  >();
  for (const order of orders) {
    if (!order.branchId) continue;
    const entry = agg.get(order.branchId) ?? {
      net: 0,
      cogs: 0,
      units: 0,
      orders: new Set(),
      customers: new Set(),
    };
    entry.net += netSales([order]);
    entry.orders.add(order.id);
    if (order.customerId) entry.customers.add(order.customerId);
    agg.set(order.branchId, entry);
  }
  for (const l of lines) {
    const bId = l.branchId;
    if (!bId) continue;
    const e = agg.get(bId) ?? { net: 0, cogs: 0, units: 0, orders: new Set(), customers: new Set() };
    e.cogs += l.unitCogsSnapshot * l.quantity;
    e.units += l.quantity;
    agg.set(bId, e);
  }

  return branches
    .map((b) => {
      const e = agg.get(b.id);
      const net = e?.net ?? 0;
      const cogs = e?.cogs ?? 0;
      return {
        ...b,
        netSales: net,
        cogs,
        marginPct: net > 0 ? (net - cogs) / net : 0,
        units: e?.units ?? 0,
        orders: e?.orders.size ?? 0,
        customers: e?.customers.size ?? 0,
      };
    })
    .sort((a, b) => b.netSales - a.netSales);
}
