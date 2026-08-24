import { describe, expect, it } from 'vitest';
import { normalizeStorefrontSlug } from '@/server/storefront/slug';

describe('storefront slugs', () => {
  it('normalizes a readable custom slug', () => {
    expect(normalizeStorefrontSlug('  Espresso Spring 225g  ', 'LHB-ESP-225')).toBe('espresso-spring-225g');
  });

  it('falls back to the permanent ASCII code when custom text cannot form a safe slug', () => {
    expect(normalizeStorefrontSlug('قهوة تركية', 'LHB-TRK-225-TG')).toBe('lhb-trk-225-tg');
  });
});
