import { StorefrontCustomerAccessError } from '@/server/storefront/customer-access';
import { authenticateStorefrontRequest, storefrontJson } from '@/server/storefront/http';
import { registrationOptions, StorefrontPasskeyError } from '@/server/storefront/passkeys';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await authenticateStorefrontRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const options = await registrationOptions(request.headers.get('authorization'), auth.config);
    return storefrontJson({ options }, { origin: auth.context.origin, allowedOrigin: auth.config.origin });
  } catch (error) {
    const known = error instanceof StorefrontPasskeyError || error instanceof StorefrontCustomerAccessError;
    return storefrontJson(
      { error: known ? error.code : 'passkey_failed' },
      { status: known ? error.status : 500, origin: auth.context.origin, allowedOrigin: auth.config.origin },
    );
  }
}
