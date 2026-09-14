import 'server-only';
import type { Prisma, Role } from '@prisma/client';
import type { DashboardFilters } from '@/lib/filters';
import { resolveRange, type ResolvedRange } from '@/lib/dates';
import { getInventoryV2Config } from '@/server/inventory-v2/config';

export interface ScopeUser {
  role: Role;
  branchId: string | null;
  locationIds?: string[];
}

export type DataScope = { branchId?: string; locationIds?: string[] };

const BRANCH_SCOPED_ROLES: Role[] = ['BRANCH_MANAGER', 'FRANCHISEE_VIEWER'];

/**
 * Branch isolation enforced at the query layer: branch managers and franchisees
 * can only ever see their own branch, regardless of URL filters.
 */
export function buildBranchScope(user: ScopeUser): DataScope {
  if (BRANCH_SCOPED_ROLES.includes(user.role)) {
    if (getInventoryV2Config().enabled) {
      return {
        ...(user.branchId ? { branchId: user.branchId } : {}),
        locationIds: user.locationIds ?? [],
      };
    }
    return {
      branchId: user.branchId ?? '__NO_ASSIGNED_BRANCH__',
    };
  }
  return {};
}

export function rangeFor(filters: DashboardFilters, now?: Date): ResolvedRange {
  return resolveRange({ range: filters.range, from: filters.from, to: filters.to }, now);
}

/** Exact persisted-order boundary for direct lookups and relationship queries. */
export function buildOrderScopeWhere(scope: DataScope): Prisma.OrderWhereInput {
  if (scope.locationIds !== undefined) {
    return { fulfillmentLocationId: { in: scope.locationIds } };
  }
  if (scope.branchId) return { branchId: scope.branchId };
  return {};
}

/** Customers are visible only when they have an order inside the caller's scope. */
export function buildCustomerScopeWhere(scope: DataScope): Prisma.CustomerWhereInput {
  if (scope.locationIds !== undefined) {
    return {
      orders: {
        some: { fulfillmentLocationId: { in: scope.locationIds } },
      },
    };
  }
  if (scope.branchId) {
    return { orders: { some: { branchId: scope.branchId } } };
  }
  return {};
}

export function buildMovementScopeWhere(scope: DataScope): Prisma.StockMovementWhereInput {
  if (scope.locationIds !== undefined) return { locationId: { in: scope.locationIds } };
  if (scope.branchId) return { branchId: scope.branchId };
  return {};
}

export function buildBatchScopeWhere(scope: DataScope): Prisma.RoastBatchWhereInput {
  if (scope.locationIds !== undefined) return { locationId: { in: scope.locationIds } };
  if (scope.branchId) return { branchId: scope.branchId };
  return {};
}

export function buildFinanceEntryScopeWhere(scope: DataScope): Prisma.FinanceEntryWhereInput {
  if (scope.locationIds !== undefined) return { stockLocationId: { in: scope.locationIds } };
  if (scope.branchId) return { branchId: scope.branchId };
  return {};
}

export function buildFinanceAccountScopeWhere(scope: DataScope): Prisma.FinanceAccountWhereInput {
  if (scope.locationIds !== undefined) return { stockLocationId: { in: scope.locationIds } };
  if (scope.branchId) return { branchId: scope.branchId };
  return {};
}

export function buildInventoryItemScopeWhere(scope: DataScope): Prisma.InventoryItemWhereInput {
  if (scope.locationIds !== undefined) {
    return {
      locationPolicies: {
        some: { locationId: { in: scope.locationIds }, isActive: true },
      },
    };
  }
  if (scope.branchId) return { branchId: scope.branchId };
  return {};
}

/** Constraint on an order line's product attributes (line/grind/roast/sku). */
function productLineConstraint(filters: DashboardFilters): Prisma.OrderLineWhereInput {
  const where: Prisma.OrderLineWhereInput = {};
  if (filters.sku?.length) where.sku = { in: filters.sku };

  const product: Prisma.ProductWhereInput = {};
  if (filters.productLine?.length) product.productLine = { in: filters.productLine };
  if (filters.grind?.length) product.grind = { in: filters.grind };
  if (filters.roastLevel?.length) product.roastLevel = { in: filters.roastLevel };
  if (filters.sizeLabel?.length) product.sizeLabel = { in: filters.sizeLabel };
  if (filters.productGroup?.length) product.groupId = { in: filters.productGroup };
  if (Object.keys(product).length) where.product = product;

  return where;
}

function hasProductFilter(filters: DashboardFilters): boolean {
  return Boolean(
    filters.sku?.length ||
      filters.productLine?.length ||
      filters.grind?.length ||
      filters.roastLevel?.length ||
      filters.sizeLabel?.length ||
      filters.productGroup?.length,
  );
}

/** Order-level scalar constraints (date, channel, city, fulfillment, branch, segment). */
function orderScalarWhere(
  filters: DashboardFilters,
  range: ResolvedRange,
  scope: DataScope,
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {
    placedAt: { gte: range.start, lte: range.end },
    ...buildOrderScopeWhere(scope),
  };
  if (scope.locationIds === undefined && !scope.branchId && filters.branchId?.length) {
    where.branchId = { in: filters.branchId };
  }
  if (filters.channel?.length) where.channel = { in: filters.channel };
  if (filters.governorate?.length) where.governorate = { in: filters.governorate };
  if (filters.fulfillment?.length) where.fulfillmentMethod = { in: filters.fulfillment };
  if (filters.segment?.length) where.customer = { segment: { in: filters.segment } };
  return where;
}

/** Where for querying Orders (includes a line-level product constraint if set). */
export function buildOrderWhere(
  filters: DashboardFilters,
  scope: DataScope,
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
  scope: DataScope,
  range = rangeFor(filters),
  saleStatuses: string[] = ['COMPLETED'],
): Prisma.OrderLineWhereInput {
  return {
    ...productLineConstraint(filters),
    order: {
      ...orderScalarWhere(filters, range, scope),
      status: { in: saleStatuses },
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
  scope: DataScope,
  range = rangeFor(filters),
): Prisma.StockMovementWhereInput {
  const where: Prisma.StockMovementWhereInput = {
    occurredAt: { lte: range.end },
    ...buildMovementScopeWhere(scope),
  };
  if (scope.locationIds === undefined && !scope.branchId && filters.branchId?.length) {
    where.branchId = { in: filters.branchId };
  }
  return where;
}

export function buildExpenseWhere(
  filters: DashboardFilters,
  scope: DataScope,
  range = rangeFor(filters),
): Prisma.ExpenseWhereInput {
  const where: Prisma.ExpenseWhereInput = {
    incurredAt: { gte: range.start, lte: range.end },
  };
  if (scope.locationIds !== undefined) where.id = { in: [] };
  else if (scope.branchId) where.branchId = scope.branchId;
  else if (filters.branchId?.length) where.branchId = { in: filters.branchId };
  return where;
}

export function buildBatchWhere(
  filters: DashboardFilters,
  scope: DataScope,
  range = rangeFor(filters),
): Prisma.RoastBatchWhereInput {
  const where: Prisma.RoastBatchWhereInput = {
    roastDate: { gte: range.start, lte: range.end },
    ...buildBatchScopeWhere(scope),
  };
  if (scope.locationIds === undefined && !scope.branchId && filters.branchId?.length) {
    where.branchId = { in: filters.branchId };
  }
  if (filters.roastLevel?.length) where.roastLevel = { in: filters.roastLevel };
  return where;
}
