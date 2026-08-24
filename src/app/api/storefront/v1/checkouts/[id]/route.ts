import { getStorefrontCheckout, StorefrontCheckoutError } from '@/server/storefront/checkout';
import { STOREFRONT_CHECKOUT_TOKEN_HEADER } from '@/server/storefront/auth';
import { authenticateStorefrontRequest, storefrontJson } from '@/server/storefront/http';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStorefrontRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const checkout = await getStorefrontCheckout(
      (await params).id,
      request.headers.get(STOREFRONT_CHECKOUT_TOKEN_HEADER),
      auth.config as typeof auth.config & {
        enabled: true;
        apiKey: string;
        origin: string;
        wayl: NonNullable<typeof auth.config.wayl>;
      },
    );
    return storefrontJson({ checkout }, {
      origin: auth.context.origin,
      allowedOrigin: auth.config.origin,
    });
  } catch (error) {
    const status = error instanceof StorefrontCheckoutError ? error.status : 500;
    const code = error instanceof StorefrontCheckoutError ? error.code : 'checkout_failed';
    return storefrontJson({ error: code }, {
      status,
      origin: auth.context.origin,
      allowedOrigin: auth.config.origin,
    });
  }
}
