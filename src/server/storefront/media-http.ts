import 'server-only';

import type { StorefrontImageResult } from './media';

export function storefrontImageResponse(
  result: StorefrontImageResult,
  extraHeaders: HeadersInit = {},
): Response {
  if (result.kind === 'external') {
    return Response.redirect(result.url, 307);
  }

  const { value } = result;
  const headers = new Headers(extraHeaders);
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  headers.set('ETag', value.blob.etag);
  if (value.statusCode === 304) return new Response(null, { status: 304, headers });

  headers.set('Content-Type', value.blob.contentType);
  headers.set('Content-Length', String(value.blob.size));
  headers.set('Content-Disposition', 'inline');
  return new Response(value.stream, { status: 200, headers });
}
