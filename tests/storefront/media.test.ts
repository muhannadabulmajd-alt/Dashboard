import { describe, expect, it } from 'vitest';
import {
  getStorefrontBlobAuth,
  storefrontImageReference,
  storefrontMediaPath,
  STOREFRONT_IMAGE_MAX_BYTES,
  StorefrontMediaError,
  validateStorefrontImage,
} from '@/server/storefront/media';

describe('storefront media validation', () => {
  it('uses the managed read/write token explicitly instead of deployment OIDC', () => {
    const previous = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = 'preview-blob-token';
    expect(getStorefrontBlobAuth()).toEqual({ token: 'preview-blob-token' });
    if (previous === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previous;
  });

  it('accepts supported image types within the size limit', () => {
    expect(() => validateStorefrontImage({ type: 'image/webp', size: 1024 })).not.toThrow();
  });

  it('keeps private Blob URLs behind the authenticated Store media route', () => {
    expect(storefrontMediaPath('products', 'turkish coffee')).toBe(
      '/api/storefront/v1/media/products/turkish%20coffee',
    );
    expect(storefrontImageReference(
      'https://store-id.private.blob.vercel-storage.com/storefront/product.jpg',
      'products',
      'turkish-coffee',
    )).toBe('/api/storefront/v1/media/products/turkish-coffee');
  });

  it('preserves external HTTPS product images', () => {
    expect(storefrontImageReference(
      'https://images.example.com/coffee.jpg',
      'groups',
      'coffee',
    )).toBe('https://images.example.com/coffee.jpg');
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
