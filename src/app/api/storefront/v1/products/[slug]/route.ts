import { getStorefrontProduct } from '@/server/storefront/catalog';
import { authenticateStorefrontRequest, storefrontJson } from '@/server/storefront/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = await authenticateStorefrontRequest(request);
  if (!auth.ok) return auth.response;
  const product = await getStorefrontProduct((await params).slug);
  return storefrontJson(
    product ? { product } : { error: 'product_not_found' },
    {
      status: product ? 200 : 404,
      origin: auth.context.origin,
      allowedOrigin: auth.config.origin,
    },
  );
}
