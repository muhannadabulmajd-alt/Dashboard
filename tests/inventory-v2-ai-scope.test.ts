import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  orderFindMany: vi.fn(),
  inventoryItemFindMany: vi.fn(),
  financeAccountFindMany: vi.fn(),
}));

vi.mock('@/server/db/client', () => ({
  prisma: {
    order: { findMany: db.orderFindMany },
    inventoryItem: { findMany: db.inventoryItemFindMany },
    financeAccount: { findMany: db.financeAccountFindMany },
  },
}));

import {
  matchFinanceAccount,
  matchInventoryItem,
  matchOrder,
} from '@/server/ai/matching';

describe('Inventory V2 AI lookup scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.orderFindMany.mockResolvedValue([]);
    db.inventoryItemFindMany.mockResolvedValue([]);
    db.financeAccountFindMany.mockResolvedValue([]);
  });

  it('limits order, inventory, and account matches to assigned locations', async () => {
    const scope = { branchId: 'legacy-branch', locationIds: ['location-a', 'location-b'] };

    await matchOrder('record', scope);
    await matchInventoryItem('coffee', scope);
    await matchFinanceAccount('cash', scope);

    expect(db.orderFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        fulfillmentLocationId: { in: ['location-a', 'location-b'] },
      }),
    }));
    expect(db.inventoryItemFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        locationPolicies: {
          some: {
            locationId: { in: ['location-a', 'location-b'] },
            isActive: true,
          },
        },
      }),
    }));
    expect(db.financeAccountFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        stockLocationId: { in: ['location-a', 'location-b'] },
      }),
    }));

    expect(db.orderFindMany.mock.calls[0]?.[0].where).not.toHaveProperty('branchId');
    expect(db.inventoryItemFindMany.mock.calls[0]?.[0].where).not.toHaveProperty('branchId');
    expect(db.financeAccountFindMany.mock.calls[0]?.[0].where).not.toHaveProperty('branchId');
  });

  it('fails closed when a scoped assistant has no assigned locations', async () => {
    const scope = { locationIds: [] as string[] };

    await matchOrder('record', scope);
    await matchInventoryItem('coffee', scope);
    await matchFinanceAccount('cash', scope);

    expect(db.orderFindMany.mock.calls[0]?.[0].where).toMatchObject({
      fulfillmentLocationId: { in: [] },
    });
    expect(db.inventoryItemFindMany.mock.calls[0]?.[0].where).toMatchObject({
      locationPolicies: { some: { locationId: { in: [] } } },
    });
    expect(db.financeAccountFindMany.mock.calls[0]?.[0].where).toMatchObject({
      stockLocationId: { in: [] },
    });
  });
});
