import { ZodError } from 'zod';
import { quoteStorefrontOrder, StorefrontCatalogError } from '@/server/storefront/catalog';
import { authenticateStorefrontRequest, storefrontJson } from '@/server/storefront/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.text();
  const auth = await authenticateStorefrontRequest(request, { body });
  if (!auth.ok) return auth.response;
  try {
    const quote = await quoteStorefrontOrder(JSON.parse(body));
    return storefrontJson({ quote }, {
      origin: auth.context.origin,
      allowedOrigin: auth.config.origin,
    });
  } catch (error) {
    const code = error instanceof StorefrontCatalogError
      ? error.code
      : error instanceof ZodError || error instanceof SyntaxError
        ? 'invalid_request'
        : 'quote_failed';
    const status = code === 'quote_failed' ? 500 : code === 'invalid_request' ? 400 : 409;
    return storefrontJson({ error: code }, {
      status,
      origin: auth.context.origin,
      allowedOrigin: auth.config.origin,
    });
  }
}
