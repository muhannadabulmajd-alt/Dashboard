import { ZodError } from 'zod';
import {
  createStorefrontCheckout,
  StorefrontCheckoutError,
  validateIdempotencyKey,
} from '@/server/storefront/checkout';
import { authenticateStorefrontRequest, storefrontJson } from '@/server/storefront/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.text();
  const auth = await authenticateStorefrontRequest(request, { body });
  if (!auth.ok) return auth.response;
  try {
    const config = auth.config;
    if (!config.wayl) throw new StorefrontCheckoutError('payment_link_failed', 503);
    const checkout = await createStorefrontCheckout(JSON.parse(body), {
      idempotencyKey: validateIdempotencyKey(request.headers.get('idempotency-key')),
      config: config as typeof config & { wayl: NonNullable<typeof config.wayl> },
      dashboardOrigin: new URL(request.url).origin,
    });
    return storefrontJson({ checkout }, {
      status: 201,
      origin: auth.context.origin,
      allowedOrigin: auth.config.origin,
    });
  } catch (error) {
    const code = error instanceof StorefrontCheckoutError
      ? error.code
      : error instanceof ZodError || error instanceof SyntaxError
        ? 'invalid_request'
        : 'checkout_failed';
    const status = error instanceof StorefrontCheckoutError
      ? error.status
      : code === 'invalid_request' ? 400 : 500;
    const details = error instanceof StorefrontCheckoutError ? error.details : undefined;
    return storefrontJson({ error: code, ...(details ? { details } : {}) }, {
      status,
      origin: auth.context.origin,
      allowedOrigin: auth.config.origin,
    });
  }
}
