import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { StorefrontCustomerAccessError } from '@/server/storefront/customer-access';
import { authenticateStorefrontRequest, storefrontJson } from '@/server/storefront/http';
import { StorefrontPasskeyError, verifyPasskeyRegistration } from '@/server/storefront/passkeys';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.text();
  const auth = await authenticateStorefrontRequest(request, { body });
  if (!auth.ok) return auth.response;
  try {
    const parsed = JSON.parse(body) as { challenge?: unknown; response?: unknown };
    if (typeof parsed.challenge !== 'string' || !parsed.response || typeof parsed.response !== 'object') {
      throw new StorefrontPasskeyError('invalid_request');
    }
    const result = await verifyPasskeyRegistration({
      authorization: request.headers.get('authorization'),
      challenge: parsed.challenge,
      response: parsed.response as RegistrationResponseJSON,
      config: auth.config,
    });
    return storefrontJson(result, { origin: auth.context.origin, allowedOrigin: auth.config.origin });
  } catch (error) {
    const known = error instanceof StorefrontPasskeyError || error instanceof StorefrontCustomerAccessError;
    const invalid = error instanceof SyntaxError;
    return storefrontJson(
      { error: known ? error.code : invalid ? 'invalid_request' : 'passkey_failed' },
      { status: known ? error.status : invalid ? 400 : 500, origin: auth.context.origin, allowedOrigin: auth.config.origin },
    );
  }
}
