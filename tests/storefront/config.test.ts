import { describe, expect, it } from 'vitest';
import { readStorefrontConfig, StorefrontConfigError } from '@/server/storefront/config';

const base = {
  STOREFRONT_ENABLED: 'true',
  STOREFRONT_API_KEY: 'a'.repeat(64),
  STOREFRONT_ORIGIN: 'https://store-git-staging.example.vercel.app',
  WAYL_API_TOKEN: 'test-token',
  WAYL_API_BASE_URL: 'https://api.thewayl.com',
  WAYL_ENV: 'test',
  WAYL_WEBHOOK_SECRET: 'webhook-secret',
  VERCEL_ENV: 'preview',
} satisfies Record<string, string>;

describe('storefront configuration', () => {
  it('accepts an isolated Preview configuration', () => {
    const config = readStorefrontConfig(base);
    expect(config.enabled).toBe(true);
    expect(config.wayl?.environment).toBe('test');
    expect(config.wayl?.baseUrl).toBe('https://api.thewayl.com');
  });

  it('accepts production on the shared Wayl host only with the live environment', () => {
    const config = readStorefrontConfig({
      ...base,
      VERCEL_ENV: 'production',
      STOREFRONT_ORIGIN: 'https://laheeb.coffee',
      WAYL_API_BASE_URL: 'https://api.thewayl.com',
      WAYL_ENV: 'live',
    });
    expect(config.wayl?.environment).toBe('live');
  });

  it('rejects the deprecated Wayl staging hostname', () => {
    expect(() => readStorefrontConfig({
      ...base,
      WAYL_API_BASE_URL: 'https://api.thewayl-staging.com',
    }))
      .toThrowError(StorefrontConfigError);
  });

  it('keeps Preview on the test environment even though the API host is shared', () => {
    expect(() => readStorefrontConfig({ ...base, WAYL_ENV: 'live' }))
      .toThrowError(StorefrontConfigError);
  });

  it('requires one exact HTTPS origin', () => {
    expect(() => readStorefrontConfig({ ...base, STOREFRONT_ORIGIN: 'https://example.com/store' }))
      .toThrowError(StorefrontConfigError);
  });

  it('enforces the documented Wayl webhook-secret length', () => {
    expect(() => readStorefrontConfig({ ...base, WAYL_WEBHOOK_SECRET: 'short' }))
      .toThrowError(StorefrontConfigError);
  });

  it('does not require secrets while the feature is disabled', () => {
    expect(readStorefrontConfig({ STOREFRONT_ENABLED: 'false' })).toMatchObject({ enabled: false });
  });
});
