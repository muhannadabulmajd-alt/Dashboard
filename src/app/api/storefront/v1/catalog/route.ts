import { NextResponse } from 'next/server';
import { getStorefrontCatalog } from '@/server/storefront/catalog';
import { authenticateStorefrontRequest, storefrontCorsHeaders, storefrontJson } from '@/server/storefront/http';
import { readStorefrontConfig } from '@/server/storefront/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(request: Request) {
  const config = readStorefrontConfig();
  if (!config.enabled || !config.origin) return new NextResponse(null, { status: 404 });
  const origin = request.headers.get('origin');
  return new NextResponse(null, {
    status: origin === config.origin ? 204 : 403,
    headers: storefrontCorsHeaders(origin, config.origin),
  });
}

export async function GET(request: Request) {
  const auth = await authenticateStorefrontRequest(request);
  if (!auth.ok) return auth.response;
  const catalog = await getStorefrontCatalog();
  return storefrontJson(catalog, {
    origin: auth.context.origin,
    allowedOrigin: auth.config.origin,
  });
}
