import 'server-only';
import { prisma } from '../client';
import { buildOrderLineWhere } from '@/server/filters/where-builder';
import type { DashboardFilters } from '@/lib/filters';
import type { ResolvedRange } from '@/lib/dates';

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
    where: { isActive: true, ...(scope.branchId ? { id: scope.branchId } : {}) },
    select: { id: true, code: true, nameEn: true, nameAr: true, isFranchise: true },
  });

  const lines = await prisma.orderLine.findMany({
    where: buildOrderLineWhere(filters, scope, range),
    select: {
      quantity: true,
      lineNet: true,
      unitCogsSnapshot: true,
      order: { select: { id: true, branchId: true, customerId: true } },
    },
  });

  const agg = new Map<
    string,
    { net: number; cogs: number; units: number; orders: Set<string>; customers: Set<string> }
  >();
  for (const l of lines) {
    const bId = l.order.branchId;
    if (!bId) continue;
    const e = agg.get(bId) ?? { net: 0, cogs: 0, units: 0, orders: new Set(), customers: new Set() };
    e.net += l.lineNet;
    e.cogs += l.unitCogsSnapshot * l.quantity;
    e.units += l.quantity;
    e.orders.add(l.order.id);
    if (l.order.customerId) e.customers.add(l.order.customerId);
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
