import { describe, expect, it } from 'vitest';
import { storefrontBearerToken, storefrontOrderLookupSchema } from '@/server/storefront/contracts';

describe('storefront customer access contracts', () => {
  it('requires both an order number and a plausible phone', () => {
    expect(storefrontOrderLookupSchema.safeParse({ orderNumber: 'LHB-ORD-260824-WEB-0001', phone: '07701234567' }).success).toBe(true);
    expect(storefrontOrderLookupSchema.safeParse({ orderNumber: 'LHB', phone: '12' }).success).toBe(false);
  });

  it('accepts only opaque bearer session tokens', () => {
    const token = 'a'.repeat(43);
    expect(storefrontBearerToken(`Bearer ${token}`)).toBe(token);
    expect(storefrontBearerToken('Bearer short')).toBeNull();
    expect(storefrontBearerToken(null)).toBeNull();
  });
});
