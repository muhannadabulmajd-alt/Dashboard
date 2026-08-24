import { describe, expect, it } from 'vitest';
import {
  deriveStorefrontCheckoutToken,
  signStorefrontRequest,
  storefrontCheckoutTokenHash,
  storefrontSignaturePayload,
  verifyStorefrontCheckoutToken,
  verifyStorefrontSignature,
} from '@/server/storefront/auth';
import { storefrontCorsHeaders } from '@/server/storefront/http';

describe('storefront request authentication', () => {
  const request = {
    apiKey: 'preview-key'.repeat(8),
    timestamp: '1787500000',
    method: 'POST',
    path: '/api/storefront/v1/quote?locale=ar',
    body: JSON.stringify({ lines: [{ sku: 'LHB-1', quantity: 2 }] }),
  };

  it('signs and verifies the exact method, path, and body', () => {
    const signature = signStorefrontRequest(request);
    expect(verifyStorefrontSignature({
      ...request,
      signature,
      now: new Date(Number(request.timestamp) * 1000),
    })).toEqual({ ok: true });
  });

  it('rejects tampered bodies and cross-environment keys', () => {
    const signature = signStorefrontRequest(request);
    expect(verifyStorefrontSignature({
      ...request,
      body: '{}',
      signature,
      now: new Date(Number(request.timestamp) * 1000),
    })).toMatchObject({ ok: false, code: 'invalid_signature' });
    expect(verifyStorefrontSignature({
      ...request,
      apiKey: 'production-key'.repeat(8),
      signature,
      now: new Date(Number(request.timestamp) * 1000),
    })).toMatchObject({ ok: false, code: 'invalid_signature' });
  });

  it('rejects expired requests', () => {
    const signature = signStorefrontRequest(request);
    expect(verifyStorefrontSignature({
      ...request,
      signature,
      now: new Date((Number(request.timestamp) + 301) * 1000),
    })).toMatchObject({ ok: false, code: 'expired_signature' });
  });

  it('keeps the canonical payload stable', () => {
    expect(storefrontSignaturePayload(request).split('\n')).toHaveLength(4);
  });
});

describe('storefront checkout access', () => {
  const apiKey = 'preview-key'.repeat(8);

  it('derives a stable checkout-scoped token and validates only its hash', () => {
    const token = deriveStorefrontCheckoutToken({ checkoutId: 'checkout-1', apiKey });
    const repeated = deriveStorefrontCheckoutToken({ checkoutId: 'checkout-1', apiKey });
    const tokenHash = storefrontCheckoutTokenHash(token);

    expect(token).toBe(repeated);
    expect(token).not.toContain(apiKey);
    expect(tokenHash).toMatch(/^[a-f\d]{64}$/);
    expect(verifyStorefrontCheckoutToken({ token, tokenHash })).toBe(true);
    expect(verifyStorefrontCheckoutToken({ token: `${token}x`, tokenHash })).toBe(false);
    expect(verifyStorefrontCheckoutToken({ token: null, tokenHash })).toBe(false);
  });

  it('isolates access tokens by checkout and environment key', () => {
    const preview = deriveStorefrontCheckoutToken({ checkoutId: 'checkout-1', apiKey });
    const otherCheckout = deriveStorefrontCheckoutToken({ checkoutId: 'checkout-2', apiKey });
    const production = deriveStorefrontCheckoutToken({
      checkoutId: 'checkout-1',
      apiKey: 'production-key'.repeat(8),
    });

    expect(preview).not.toBe(otherCheckout);
    expect(preview).not.toBe(production);
  });
});

describe('storefront CORS', () => {
  const allowed = 'https://store.example.com';

  it('echoes only the exact allowed origin', () => {
    expect(storefrontCorsHeaders(allowed, allowed)).toMatchObject({
      Vary: 'Origin',
      'Access-Control-Allow-Origin': allowed,
    });
    expect(storefrontCorsHeaders('https://evil.example.com', allowed)).toEqual({ Vary: 'Origin' });
  });
});
