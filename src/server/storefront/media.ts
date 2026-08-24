import 'server-only';

import { del, put } from '@vercel/blob';
import { prisma } from '@/server/db/client';

export const STOREFRONT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const STOREFRONT_IMAGE_TYPES = [
  'image/avif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type StorefrontMediaTarget = 'product' | 'productGroup';

export function getStorefrontBlobAuth(): { token: string } {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new StorefrontMediaError('blob_not_configured');
  return { token };
}

export class StorefrontMediaError extends Error {
  constructor(
    readonly code:
      | 'blob_not_configured'
      | 'invalid_file'
      | 'invalid_target'
      | 'not_found'
      | 'upload_failed',
  ) {
    super(code);
    this.name = 'StorefrontMediaError';
  }
}

export function validateStorefrontImage(file: Pick<File, 'size' | 'type'>): void {
  if (
    file.size <= 0 ||
    file.size > STOREFRONT_IMAGE_MAX_BYTES ||
    !STOREFRONT_IMAGE_TYPES.includes(file.type as (typeof STOREFRONT_IMAGE_TYPES)[number])
  ) {
    throw new StorefrontMediaError('invalid_file');
  }
}

function extensionFor(type: string): string {
  if (type === 'image/jpeg') return 'jpg';
  return type.slice('image/'.length);
}

function isManagedBlobUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.public.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

function describeBlobFailure(error: unknown): Record<string, string | number | undefined> {
  if (!(error instanceof Error)) return { name: 'UnknownBlobError' };
  const details = error as Error & { code?: string; status?: number; statusCode?: number };
  return {
    name: details.name,
    code: details.code,
    status: details.status ?? details.statusCode,
    message: details.message
      .replace(/(authorization|token|secret)(\s*[:=]\s*)\S+/gi, '$1$2[redacted]')
      .slice(0, 300),
  };
}

export async function replaceStorefrontImage(input: {
  target: StorefrontMediaTarget;
  targetId: string;
  file: File;
  userId: string;
}): Promise<{ url: string }> {
  const blobAuth = getStorefrontBlobAuth();
  validateStorefrontImage(input.file);
  if (!input.targetId.trim()) throw new StorefrontMediaError('invalid_target');

  const current = input.target === 'product'
    ? await prisma.product.findUnique({ where: { id: input.targetId }, select: { imageUrl: true } })
    : await prisma.productGroup.findUnique({ where: { id: input.targetId }, select: { imageUrl: true } });
  if (!current) throw new StorefrontMediaError('not_found');

  let blob: Awaited<ReturnType<typeof put>>;
  try {
    blob = await put(
      `storefront/${input.target}/${input.targetId}/primary.${extensionFor(input.file.type)}`,
      input.file,
      { access: 'public', addRandomSuffix: true, ...blobAuth },
    );
  } catch (error) {
    console.error('[storefront-media] Blob upload failed', describeBlobFailure(error));
    throw new StorefrontMediaError('upload_failed');
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (input.target === 'product') {
        await tx.product.update({ where: { id: input.targetId }, data: { imageUrl: blob.url } });
      } else {
        await tx.productGroup.update({ where: { id: input.targetId }, data: { imageUrl: blob.url } });
      }
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: 'STOREFRONT_IMAGE_REPLACE',
          entity: input.target === 'product' ? 'Product' : 'ProductGroup',
          entityId: input.targetId,
          metadata: { previousUrl: current.imageUrl, imageUrl: blob.url },
        },
      });
    });
  } catch (error) {
    await del(blob.url, blobAuth).catch(() => undefined);
    throw error;
  }

  if (isManagedBlobUrl(current.imageUrl)) {
    await del(current.imageUrl, blobAuth).catch(() => undefined);
  }
  return { url: blob.url };
}
