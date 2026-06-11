import 'server-only';
import type { Prisma, Role } from '@prisma/client';
import type { DashboardFilters } from '@/lib/filters';
import { resolveRange, type ResolvedRange } from '@/lib/dates';

export interface ScopeUser {
  role: Role;
  branchId: string | null;
}

const BRANCH_SCOPED_ROLES: Role[] = ['BRANCH_MANAGER', 'FRANCHISEE_VIEWER'];

/**
 * Branch isolation enforced at the query layer: branch managers and franchisees
 * can only ever see their own branch, regardless of URL filters.
 */
export function buildBranchScope(user: ScopeUser): { branchId?: string } {
  if (BRANCH_SCOPED_ROLES.includes(user.role) && user.branchId) {
    return { branchId: user.branchId };
  }
  return {};
}

export function rangeFor(filters: DashboardFilters, now?: Date): ResolvedRange {
  return resolveRange({ range: filters.range, from: filters.from, to: filters.to }, now);
}

/** Constraint on an order line's product attributes (line/grind/roast/sku). */
function productLineConstraint(filters: DashboardFilters): Prisma.OrderLineWhereInput {
  const where: Prisma.OrderLineWhereInput = {};
  if (filters.sku?.length) where.sku = { in: filters.sku };

  const product: Prisma.ProductWhereInput = {};
  if (filters.productLine?.length) product.productLine = { in: filters.productLine };
  if (filters.grind?.length) product.grind = { in: filters.grind };
  if (filters.roastLevel?.length) product.roastLevel = { in: filters.roastLevel };
  if (Object.keys(product).length) where.product = product;

  return where;
}

function hasProductFilter(filters: DashboardFilters): boolean {
  return Boolean(
    filters.sku?.length ||
      filters.productLine?.length ||
      filters.grind?.length ||
      filters.roastLevel?.length,
  );
}

/** Order-level scalar constraints (date, channel, city, fulfillment, branch, segment). */
function orderScalarWhere(
  filters: DashboardFilters,
  range: ResolvedRange,
  scope: { branchId?: string },
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {
    placedAt: { gte: range.start, lte: range.end },
  };
  if (scope.branchId) where.branchId = scope.branchId;
  else if (filters.branchId?.length) where.branchId = { in: filters.branchId };
  if (filters.channel?.length) where.channel = { in: filters.channel };
  if (filters.governorate?.length) where.governorate = { in: filters.governorate };
  if (filters.fulfillment?.length) where.fulfillmentMethod = { in: filters.fulfillment };
  if (filters.segment?.length) where.customer = { segment: { in: filters.segment } };
  return where;
}

/** Where for querying Orders (includes a line-level product constraint if set). */
export function buildOrderWhere(
  filters: DashboardFilters,
  scope: { branchId?: string },
  range = rangeFor(filters),
): Prisma.OrderWhereInput {
  const where = orderScalarWhere(filters, range, scope);
  if (hasProductFilter(filters)) {
    where.lines = { some: productLineConstraint(filters) };
  }
  return where;
}

/** Where for querying OrderLines of sales orders matching the filters. */
export function buildOrderLineWhere(
  filters: DashboardFilters,
  scope: { branchId?: string },
  range = rangeFor(filters),
): Prisma.OrderLineWhereInput {
  return {
    ...productLineConstraint(filters),
    order: {
      ...orderScalarWhere(filters, range, scope),
      status: { notIn: ['CANCELLED', 'PENDING'] },
    },
  };
}

/**
 * Where for stock movements. Inventory is a cumulative ledger, so we include all
 * movements up to the end of the period (current stock); the metric layer derives
 * opening/closing using the period start.
 */
export function buildMovementWhere(
  filters: DashboardFilters,
  scope: { branchId?: string },
  range = rangeFor(filters),
): Prisma.StockMovementWhereInput {
  const where: Prisma.StockMovementWhereInput = { occurredAt: { lte: range.end } };
  if (scope.branchId) where.branchId = scope.branchId;
  else if (filters.branchId?.length) where.branchId = { in: filters.branchId };
  return where;
}

export function buildExpenseWhere(
  filters: DashboardFilters,
  scope: { branchId?: string },
  range = rangeFor(filters),
): Prisma.ExpenseWhereInput {
  const where: Prisma.ExpenseWhereInput = {
    incurredAt: { gte: range.start, lte: range.end },
  };
  if (scope.branchId) where.branchId = scope.branchId;
  else if (filters.branchId?.length) where.branchId = { in: filters.branchId };
  return where;
}

export function buildBatchWhere(
  filters: DashboardFilters,
  scope: { branchId?: string },
  range = rangeFor(filters),
): Prisma.RoastBatchWhereInput {
  const where: Prisma.RoastBatchWhereInput = {
    roastDate: { gte: range.start, lte: range.end },
  };
  if (scope.branchId) where.branchId = scope.branchId;
  else if (filters.branchId?.length) where.branchId = { in: filters.branchId };
  if (filters.roastLevel?.length) where.roastLevel = { in: filters.roastLevel };
  return where;
}
