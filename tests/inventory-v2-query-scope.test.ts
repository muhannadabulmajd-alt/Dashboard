import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildBatchWhere,
  buildBatchScopeWhere,
  buildBranchScope,
  buildCustomerScopeWhere,
  buildExpenseWhere,
  buildFinanceAccountScopeWhere,
  buildFinanceEntryScopeWhere,
  buildInventoryItemScopeWhere,
  buildMovementWhere,
  buildMovementScopeWhere,
  buildOrderScopeWhere,
  buildOrderWhere,
} from '@/server/filters/where-builder';
import { canManageExistingCustomer } from '@/server/records/customer-policy';

const range = {
  start: new Date('2026-09-08T21:00:00.000Z'),
  end: new Date('2026-09-09T20:59:59.999Z'),
};
const filters = { range: 'today' as const, branchId: ['untrusted-branch-filter'] };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Inventory V2 analytics query scope', () => {
  it('carries permitted locations into order, movement, and production queries', () => {
    vi.stubEnv('INVENTORY_V2_ENABLED', 'true');
    const scope = buildBranchScope({
      role: 'BRANCH_MANAGER',
      branchId: 'legacy-branch',
      locationIds: ['sales-point-a', 'sales-point-b'],
    });

    expect(buildOrderWhere(filters, scope, range)).toMatchObject({
      fulfillmentLocationId: { in: ['sales-point-a', 'sales-point-b'] },
    });
    expect(buildOrderScopeWhere(scope)).toEqual({
      fulfillmentLocationId: { in: ['sales-point-a', 'sales-point-b'] },
    });
    expect(buildCustomerScopeWhere(scope)).toEqual({
      orders: {
        some: {
          fulfillmentLocationId: { in: ['sales-point-a', 'sales-point-b'] },
        },
      },
    });
    expect(buildMovementWhere(filters, scope, range)).toMatchObject({
      locationId: { in: ['sales-point-a', 'sales-point-b'] },
    });
    expect(buildMovementScopeWhere(scope)).toEqual({
      locationId: { in: ['sales-point-a', 'sales-point-b'] },
    });
    expect(buildBatchWhere(filters, scope, range)).toMatchObject({
      locationId: { in: ['sales-point-a', 'sales-point-b'] },
    });
    expect(buildBatchScopeWhere(scope)).toEqual({
      locationId: { in: ['sales-point-a', 'sales-point-b'] },
    });
    expect(buildFinanceEntryScopeWhere(scope)).toEqual({
      stockLocationId: { in: ['sales-point-a', 'sales-point-b'] },
    });
    expect(buildFinanceAccountScopeWhere(scope)).toEqual({
      stockLocationId: { in: ['sales-point-a', 'sales-point-b'] },
    });
    expect(buildInventoryItemScopeWhere(scope)).toEqual({
      locationPolicies: {
        some: {
          locationId: { in: ['sales-point-a', 'sales-point-b'] },
          isActive: true,
        },
      },
    });
    expect(buildExpenseWhere(filters, scope, range)).toMatchObject({ id: { in: [] } });
  });

  it('keeps existing company-wide customer identities centrally governed', () => {
    expect(canManageExistingCustomer('OWNER')).toBe(true);
    expect(canManageExistingCustomer('ADMIN')).toBe(true);
    expect(canManageExistingCustomer('FINANCE')).toBe(true);
    expect(canManageExistingCustomer('SALES_CRM')).toBe(true);
    expect(canManageExistingCustomer('BRANCH_MANAGER')).toBe(false);
    expect(canManageExistingCustomer('FRANCHISEE_VIEWER')).toBe(false);
    expect(canManageExistingCustomer('VIEWER')).toBe(false);
  });

  it('fails closed for a location-scoped user with no assigned locations', () => {
    vi.stubEnv('INVENTORY_V2_ENABLED', 'true');
    const scope = buildBranchScope({
      role: 'BRANCH_MANAGER',
      branchId: null,
      locationIds: [],
    });
    expect(scope).toEqual({ locationIds: [] });
    expect(buildCustomerScopeWhere(scope)).toEqual({
      orders: { some: { fulfillmentLocationId: { in: [] } } },
    });
    expect(buildOrderWhere({ range: 'all' }, scope, range)).toMatchObject({
      fulfillmentLocationId: { in: [] },
    });
    expect(buildFinanceEntryScopeWhere(scope)).toEqual({ stockLocationId: { in: [] } });
    expect(buildFinanceAccountScopeWhere(scope)).toEqual({ stockLocationId: { in: [] } });
    expect(buildInventoryItemScopeWhere(scope)).toMatchObject({
      locationPolicies: { some: { locationId: { in: [] } } },
    });
  });

  it('keeps the legacy branch boundary while Inventory V2 is disabled', () => {
    vi.stubEnv('INVENTORY_V2_ENABLED', 'false');
    const scope = buildBranchScope({
      role: 'BRANCH_MANAGER',
      branchId: 'branch-a',
      locationIds: ['ignored-location'],
    });
    expect(scope).toEqual({ branchId: 'branch-a' });
    expect(buildCustomerScopeWhere(scope)).toEqual({
      orders: { some: { branchId: 'branch-a' } },
    });
    expect(buildOrderWhere({ range: 'all' }, scope, range)).toMatchObject({ branchId: 'branch-a' });
  });

  it('does not constrain global customer access', () => {
    expect(buildCustomerScopeWhere({})).toEqual({});
  });
});
