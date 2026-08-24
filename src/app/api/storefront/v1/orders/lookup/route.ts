import { ZodError } from 'zod';
import { lookupStorefrontOrder, StorefrontCustomerAccessError } from '@/server/storefront/customer-access';
import { authenticateStorefrontRequest, storefrontJson } from '@/server/storefront/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.text();
  const auth = await authenticateStorefrontRequest(request, { body });
  if (!auth.ok) return auth.response;
  try {
    const order = await lookupStorefrontOrder(JSON.parse(body));
    return storefrontJson({ order }, { origin: auth.context.origin, allowedOrigin: auth.config.origin });
  } catch (error) {
    const code = error instanceof StorefrontCustomerAccessError ? error.code : error instanceof ZodError || error instanceof SyntaxError ? 'invalid_request' : 'lookup_failed';
    const status = error instanceof StorefrontCustomerAccessError ? error.status : code === 'invalid_request' ? 400 : 500;
    return storefrontJson({ error: code }, { status, origin: auth.context.origin, allowedOrigin: auth.config.origin });
  }
}
