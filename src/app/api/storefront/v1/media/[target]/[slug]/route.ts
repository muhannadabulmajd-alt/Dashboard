import { authenticateStorefrontRequest, storefrontCorsHeaders } from '@/server/storefront/http';
import { storefrontImageResponse } from '@/server/storefront/media-http';
import { readStorefrontImage, StorefrontMediaError, type StorefrontMediaTarget } from '@/server/storefront/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ target: string; slug: string }> },
) {
  const auth = await authenticateStorefrontRequest(request);
  if (!auth.ok) return auth.response;

  const { target, slug } = await params;
  const mediaTarget: StorefrontMediaTarget | null = target === 'products'
    ? 'product'
    : target === 'groups'
      ? 'productGroup'
      : null;
  if (!mediaTarget) {
    return Response.json({ error: 'invalid_target' }, { status: 400 });
  }

  try {
    const result = await readStorefrontImage({
      target: mediaTarget,
      slug,
      publishedOnly: true,
      ifNoneMatch: request.headers.get('if-none-match'),
    });
    return storefrontImageResponse(
      result,
      storefrontCorsHeaders(auth.context.origin, auth.config.origin),
    );
  } catch (error) {
    if (error instanceof StorefrontMediaError) {
      const status = error.code === 'not_found' ? 404 : error.code === 'read_failed' ? 502 : 400;
      return Response.json({ error: error.code }, { status });
    }
    return Response.json({ error: 'media_read_failed' }, { status: 500 });
  }
}
