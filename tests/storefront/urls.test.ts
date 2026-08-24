import { describe, expect, it } from 'vitest';
import {
  storefrontCheckoutReturnUrl,
  WAYL_PAYMENT_LINK_EXPIRY,
  WAYL_PAYMENT_LINK_EXPIRY_MS,
} from '@/server/storefront/urls';

describe('storefront Wayl return URLs', () => {
  it('uses a query-free checkout path so Wayl can append its own parameters', () => {
    const url = storefrontCheckoutReturnUrl({
      origin: 'https://store.example.test',
      locale: 'ar',
      checkoutId: '6ea2dee7-dac0-45dc-9aa3-06cfd85a917f',
    });

    expect(url).toBe(
      'https://store.example.test/ar/checkout/return/6ea2dee7-dac0-45dc-9aa3-06cfd85a917f',
    );
    expect(new URL(url).search).toBe('');
  });

  it('keeps the application and Wayl expiry at exactly fifteen minutes', () => {
    expect(WAYL_PAYMENT_LINK_EXPIRY).toBe('15m');
    expect(WAYL_PAYMENT_LINK_EXPIRY_MS).toBe(15 * 60 * 1000);
  });
});
