import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { authenticateStorefrontRequest, storefrontJson } from '@/server/storefront/http';
import { StorefrontPasskeyError, verifyPasskeyAuthentication } from '@/server/storefront/passkeys';

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
    const session = await verifyPasskeyAuthentication({
      challenge: parsed.challenge,
      response: parsed.response as AuthenticationResponseJSON,
      config: auth.config,
    });
    return storefrontJson({ session }, { origin: auth.context.origin, allowedOrigin: auth.config.origin });
  } catch (error) {
    const known = error instanceof StorefrontPasskeyError;
    const invalid = error instanceof SyntaxError;
    return storefrontJson(
      { error: known ? error.code : invalid ? 'invalid_request' : 'passkey_failed' },
      { status: known ? error.status : invalid ? 400 : 500, origin: auth.context.origin, allowedOrigin: auth.config.origin },
    );
  }
}
