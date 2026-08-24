import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const STOREFRONT_TIMESTAMP_HEADER = 'x-atlas-timestamp';
export const STOREFRONT_SIGNATURE_HEADER = 'x-atlas-signature';
export const STOREFRONT_CHECKOUT_TOKEN_HEADER = 'x-storefront-checkout-token';
export const STOREFRONT_SIGNATURE_TTL_SECONDS = 300;

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function storefrontSignaturePayload(input: {
  timestamp: string;
  method: string;
  path: string;
  body: string | Uint8Array;
}): string {
  return [
    input.timestamp,
    input.method.toUpperCase(),
    input.path,
    sha256Hex(input.body),
  ].join('\n');
}

export function signStorefrontRequest(input: {
  apiKey: string;
  timestamp: string;
  method: string;
  path: string;
  body?: string | Uint8Array;
}): string {
  return createHmac('sha256', input.apiKey)
    .update(storefrontSignaturePayload({ ...input, body: input.body ?? '' }))
    .digest('hex');
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function deriveStorefrontCheckoutToken(input: {
  checkoutId: string;
  apiKey: string;
}): string {
  return createHmac('sha256', input.apiKey)
    .update(`storefront-checkout:${input.checkoutId}`)
    .digest('base64url');
}

export function storefrontCheckoutTokenHash(token: string): string {
  return sha256Hex(token);
}

export function verifyStorefrontCheckoutToken(input: {
  token?: string | null;
  tokenHash: string;
}): boolean {
  if (!input.token) return false;
  return safeEqualHex(storefrontCheckoutTokenHash(input.token), input.tokenHash);
}

export function verifyStorefrontSignature(input: {
  apiKey: string;
  timestamp?: string | null;
  signature?: string | null;
  method: string;
  path: string;
  body?: string | Uint8Array;
  now?: Date;
}): { ok: true } | { ok: false; code: 'missing_signature' | 'expired_signature' | 'invalid_signature' } {
  if (!input.timestamp || !input.signature) return { ok: false, code: 'missing_signature' };
  const timestamp = Number(input.timestamp);
  if (!Number.isInteger(timestamp)) return { ok: false, code: 'invalid_signature' };

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - timestamp) > STOREFRONT_SIGNATURE_TTL_SECONDS) {
    return { ok: false, code: 'expired_signature' };
  }

  const expected = signStorefrontRequest({
    apiKey: input.apiKey,
    timestamp: input.timestamp,
    method: input.method,
    path: input.path,
    body: input.body ?? '',
  });
  return safeEqualHex(expected, input.signature)
    ? { ok: true }
    : { ok: false, code: 'invalid_signature' };
}
