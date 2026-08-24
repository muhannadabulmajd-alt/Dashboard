import { NextResponse } from 'next/server';
import { can } from '@/lib/rbac';
import { getCurrentUser } from '@/server/auth/session';
import {
  replaceStorefrontImage,
  StorefrontMediaError,
  type StorefrontMediaTarget,
} from '@/server/storefront/media';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!can(user.role, 'manage:products')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const data = await request.formData();
  const file = data.get('file');
  const target = data.get('target');
  const targetId = data.get('targetId');
  if (
    !(file instanceof File) ||
    (target !== 'product' && target !== 'productGroup') ||
    typeof targetId !== 'string'
  ) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const result = await replaceStorefrontImage({
      target: target as StorefrontMediaTarget,
      targetId,
      file,
      userId: user.id,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StorefrontMediaError) {
      const status = error.code === 'not_found' ? 404 : error.code === 'upload_failed' ? 502 : 400;
      return NextResponse.json({ error: error.code }, { status });
    }
    return NextResponse.json({ error: 'media_update_failed' }, { status: 500 });
  }
}
