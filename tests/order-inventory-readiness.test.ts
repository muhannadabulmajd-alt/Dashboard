import { describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { resolveOrderInventoryReadiness } from '@/server/orders/sync';

function transaction(input: {
  products: Array<{ id: string; sku: string; trackInventory: boolean; isActive: boolean }>;
  items?: Array<{ id: string; productId: string | null }>;
}) {
  return {
    product: {
      findMany: async () => input.products,
    },
    inventoryItem: {
      findMany: async () => input.items ?? [],
    },
  } as unknown as Prisma.TransactionClient;
}

describe('order inventory readiness', () => {
  it('keeps normal stock sync when every tracked product has one active item', async () => {
    const result = await resolveOrderInventoryReadiness(transaction({
      products: [
        { id: 'p1', sku: 'SKU-1', trackInventory: true, isActive: true },
        { id: 'p2', sku: 'SKU-2', trackInventory: false, isActive: true },
      ],
      items: [{ id: 'i1', productId: 'p1' }],
    }), ['p1', 'p2']);

    expect(result).toEqual({ mode: 'NORMAL', unconfiguredSkus: [] });
  });

  it('uses the explicit historical mode when a tracked SKU has no stock link', async () => {
    const result = await resolveOrderInventoryReadiness(transaction({
      products: [
        { id: 'p1', sku: 'SKU-1', trackInventory: true, isActive: true },
        { id: 'p2', sku: 'SKU-2', trackInventory: true, isActive: true },
      ],
      items: [{ id: 'i2', productId: 'p2' }],
    }), ['p1', 'p2']);

    expect(result).toEqual({ mode: 'SKIP_HISTORICAL', unconfiguredSkus: ['SKU-1'] });
  });

  it('rejects ambiguous stock configuration instead of guessing', async () => {
    await expect(resolveOrderInventoryReadiness(transaction({
      products: [{ id: 'p1', sku: 'SKU-1', trackInventory: true, isActive: true }],
      items: [
        { id: 'i1', productId: 'p1' },
        { id: 'i2', productId: 'p1' },
      ],
    }), ['p1'])).rejects.toThrow('stock_configuration_ambiguous:SKU-1');
  });
});
