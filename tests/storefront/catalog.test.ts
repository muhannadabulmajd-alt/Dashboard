import { describe, expect, it } from 'vitest';
import { storefrontQuoteSchema } from '@/server/storefront/catalog';

describe('storefront quote contract', () => {
  it('accepts bounded integer quantities only', () => {
    expect(storefrontQuoteSchema.safeParse({
      lines: [{ sku: 'LHB-TRK-1', quantity: 2 }],
      deliveryZoneCode: 'BAGHDAD',
    }).success).toBe(true);
    expect(storefrontQuoteSchema.safeParse({
      lines: [{ sku: 'LHB-TRK-1', quantity: 0 }],
    }).success).toBe(false);
    expect(storefrontQuoteSchema.safeParse({
      lines: [{ sku: 'LHB-TRK-1', quantity: 1.5 }],
    }).success).toBe(false);
  });

  it('limits a request to 100 distinct line submissions', () => {
    expect(storefrontQuoteSchema.safeParse({
      lines: Array.from({ length: 101 }, (_, index) => ({ sku: `SKU-${index}`, quantity: 1 })),
    }).success).toBe(false);
  });
});
