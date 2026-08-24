import { revokeStorefrontCustomerSession, StorefrontCustomerAccessError } from '@/server/storefront/customer-access';
import { authenticateStorefrontRequest, storefrontJson } from '@/server/storefront/http';

export const runtime = 'nodejs';

export async function DELETE(request: Request) {
  const auth = await authenticateStorefrontRequest(request);
  if (!auth.ok) return auth.response;
  try {
    await revokeStorefrontCustomerSession(request.headers.get('authorization'));
    return storefrontJson({ revoked: true }, { origin: auth.context.origin, allowedOrigin: auth.config.origin });
  } catch (error) {
    const status = error instanceof StorefrontCustomerAccessError ? error.status : 500;
    const code = error instanceof StorefrontCustomerAccessError ? error.code : 'session_failed';
    return storefrontJson({ error: code }, { status, origin: auth.context.origin, allowedOrigin: auth.config.origin });
  }
}
