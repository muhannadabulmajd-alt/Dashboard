import { authenticateStorefrontRequest, storefrontJson } from '@/server/storefront/http';
import { authenticationOptions, StorefrontPasskeyError } from '@/server/storefront/passkeys';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await authenticateStorefrontRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const options = await authenticationOptions(auth.config);
    return storefrontJson({ options }, { origin: auth.context.origin, allowedOrigin: auth.config.origin });
  } catch (error) {
    const known = error instanceof StorefrontPasskeyError;
    return storefrontJson(
      { error: known ? error.code : 'passkey_failed' },
      { status: known ? error.status : 500, origin: auth.context.origin, allowedOrigin: auth.config.origin },
    );
  }
}
