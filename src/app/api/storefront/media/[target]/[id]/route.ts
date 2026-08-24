import { can } from '@/lib/rbac';
import { getCurrentUser } from '@/server/auth/session';
import { storefrontImageResponse } from '@/server/storefront/media-http';
import { readStorefrontImage, StorefrontMediaError, type StorefrontMediaTarget } from '@/server/storefront/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ target: string; id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!can(user.role, 'manage:products')) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const { target, id } = await params;
  if (target !== 'product' && target !== 'productGroup') {
    return Response.json({ error: 'invalid_target' }, { status: 400 });
  }

  try {
    const result = await readStorefrontImage({
      target: target as StorefrontMediaTarget,
      targetId: id,
      publishedOnly: false,
      ifNoneMatch: request.headers.get('if-none-match'),
    });
    return storefrontImageResponse(result);
  } catch (error) {
    if (error instanceof StorefrontMediaError) {
      const status = error.code === 'not_found' ? 404 : error.code === 'read_failed' ? 502 : 400;
      return Response.json({ error: error.code }, { status });
    }
    return Response.json({ error: 'media_read_failed' }, { status: 500 });
  }
}
