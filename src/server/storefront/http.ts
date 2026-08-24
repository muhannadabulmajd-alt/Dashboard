import 'server-only';
import { NextResponse } from 'next/server';
import { readStorefrontConfig, StorefrontConfigError } from './config';
import {
  STOREFRONT_SIGNATURE_HEADER,
  STOREFRONT_TIMESTAMP_HEADER,
  verifyStorefrontSignature,
} from './auth';

export type StorefrontRequestContext = {
  body: string;
  origin: string | null;
};

export function storefrontCorsHeaders(requestOrigin: string | null, allowedOrigin: string): HeadersInit {
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (requestOrigin === allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
    headers['Access-Control-Allow-Headers'] = [
      'Content-Type',
      STOREFRONT_TIMESTAMP_HEADER,
      STOREFRONT_SIGNATURE_HEADER,
      'Idempotency-Key',
      'Authorization',
    ].join(', ');
    headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
  }
  return headers;
}

export async function authenticateStorefrontRequest(
  request: Request,
  options: { body?: string; requireOrigin?: boolean } = {},
): Promise<
  | { ok: true; config: ReturnType<typeof readStorefrontConfig> & { enabled: true; apiKey: string; origin: string }; context: StorefrontRequestContext }
  | { ok: false; response: NextResponse }
> {
  let config: ReturnType<typeof readStorefrontConfig>;
  try {
    config = readStorefrontConfig();
  } catch (error) {
    const code = error instanceof StorefrontConfigError ? error.code : 'invalid_configuration';
    return { ok: false, response: NextResponse.json({ error: code }, { status: 503 }) };
  }
  if (!config.enabled || !config.apiKey || !config.origin) {
    return { ok: false, response: NextResponse.json({ error: 'storefront_disabled' }, { status: 404 }) };
  }

  const origin = request.headers.get('origin');
  const corsHeaders = storefrontCorsHeaders(origin, config.origin);
  if ((origin && origin !== config.origin) || (options.requireOrigin && origin !== config.origin)) {
    return { ok: false, response: NextResponse.json({ error: 'origin_not_allowed' }, { status: 403, headers: corsHeaders }) };
  }

  const url = new URL(request.url);
  const body = options.body ?? '';
  const verification = verifyStorefrontSignature({
    apiKey: config.apiKey,
    timestamp: request.headers.get(STOREFRONT_TIMESTAMP_HEADER),
    signature: request.headers.get(STOREFRONT_SIGNATURE_HEADER),
    method: request.method,
    path: `${url.pathname}${url.search}`,
    body,
  });
  if (!verification.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: verification.code }, { status: 401, headers: corsHeaders }),
    };
  }
  return {
    ok: true,
    config: config as typeof config & { enabled: true; apiKey: string; origin: string },
    context: { body, origin },
  };
}

export function storefrontJson(
  data: unknown,
  options: { status?: number; origin?: string | null; allowedOrigin: string },
): NextResponse {
  return NextResponse.json(data, {
    status: options.status ?? 200,
    headers: storefrontCorsHeaders(options.origin ?? null, options.allowedOrigin),
  });
}
