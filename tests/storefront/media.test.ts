import { describe, expect, it } from 'vitest';
import {
  STOREFRONT_IMAGE_MAX_BYTES,
  StorefrontMediaError,
  validateStorefrontImage,
} from '@/server/storefront/media';

describe('storefront media validation', () => {
  it('accepts supported image types within the size limit', () => {
    expect(() => validateStorefrontImage({ type: 'image/webp', size: 1024 })).not.toThrow();
  });

  it.each(['image/svg+xml', 'text/html', 'application/pdf'])('rejects %s uploads', (type) => {
    expect(() => validateStorefrontImage({ type, size: 1024 })).toThrowError(StorefrontMediaError);
  });

  it('rejects empty and oversized files', () => {
    expect(() => validateStorefrontImage({ type: 'image/png', size: 0 })).toThrowError('invalid_file');
    expect(() => validateStorefrontImage({
      type: 'image/png',
      size: STOREFRONT_IMAGE_MAX_BYTES + 1,
    })).toThrowError('invalid_file');
  });
});
