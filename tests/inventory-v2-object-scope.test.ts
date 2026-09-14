import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  financeAccountWhereForScope,
  inventoryItemWhereForScope,
  orderWhereForScope,
  roastBatchWhereForScope,
  stockDocumentWhereForScope,
  type LocationObjectScope,
} from '@/server/inventory-v2/object-scope';

const restrictedScope: LocationObjectScope = {
  unrestricted: false,
  locationIds: ['location-a', 'location-b'],
  branchIds: ['branch-a'],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Inventory V2 object scope', () => {
  it('keeps legacy branch filters while the feature is disabled', () => {
    vi.stubEnv('INVENTORY_V2_ENABLED', 'false');

    expect(orderWhereForScope(restrictedScope)).toEqual({
      branchId: { in: ['branch-a'] },
    });
    expect(inventoryItemWhereForScope(restrictedScope)).toEqual({
      branchId: { in: ['branch-a'] },
    });
    expect(financeAccountWhereForScope(restrictedScope)).toEqual({
      branchId: { in: ['branch-a'] },
    });
    expect(roastBatchWhereForScope(restrictedScope)).toEqual({
      branchId: { in: ['branch-a'] },
    });
    expect(stockDocumentWhereForScope(restrictedScope)).toEqual({
      movements: { some: { branchId: { in: ['branch-a'] } } },
    });
  });

  it('uses explicit locations for orders, items, and accounts when enabled', () => {
    vi.stubEnv('INVENTORY_V2_ENABLED', 'true');

    expect(orderWhereForScope(restrictedScope)).toEqual({
      fulfillmentLocationId: { in: ['location-a', 'location-b'] },
    });
    expect(inventoryItemWhereForScope(restrictedScope)).toEqual({
      locationPolicies: {
        some: {
          locationId: { in: ['location-a', 'location-b'] },
          isActive: true,
        },
      },
    });
    expect(financeAccountWhereForScope(restrictedScope)).toEqual({
      stockLocationId: { in: ['location-a', 'location-b'] },
    });
    expect(roastBatchWhereForScope(restrictedScope)).toEqual({
      locationId: { in: ['location-a', 'location-b'] },
    });
    expect(stockDocumentWhereForScope(restrictedScope)).toEqual({
      OR: [
        { sourceLocationId: { in: ['location-a', 'location-b'] } },
        { destinationLocationId: { in: ['location-a', 'location-b'] } },
        { movements: { some: { locationId: { in: ['location-a', 'location-b'] } } } },
      ],
    });
  });

  it('does not constrain global actors', () => {
    vi.stubEnv('INVENTORY_V2_ENABLED', 'true');
    const globalScope: LocationObjectScope = {
      unrestricted: true,
      locationIds: [],
      branchIds: [],
    };

    expect(orderWhereForScope(globalScope)).toEqual({});
    expect(inventoryItemWhereForScope(globalScope)).toEqual({});
    expect(financeAccountWhereForScope(globalScope)).toEqual({});
    expect(roastBatchWhereForScope(globalScope)).toEqual({});
    expect(stockDocumentWhereForScope(globalScope)).toEqual({});
  });
});
