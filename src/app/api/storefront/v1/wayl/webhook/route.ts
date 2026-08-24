import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readStorefrontConfig, StorefrontConfigError } from '@/server/storefront/config';
import { sha256Hex } from '@/server/storefront/auth';
import { processWaylWebhook } from '@/server/storefront/webhook';
import { verifyWaylWebhookSignature } from '@/server/storefront/wayl';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let config: ReturnType<typeof readStorefrontConfig>;
  try {
    config = readStorefrontConfig();
  } catch (error) {
    const code = error instanceof StorefrontConfigError ? error.code : 'invalid_configuration';
    return NextResponse.json({ error: code }, { status: 503 });
  }
  if (!config.enabled || !config.wayl) {
    return NextResponse.json({ error: 'storefront_disabled' }, { status: 404 });
  }
  const rawBody = await request.text();
  const signature = request.headers.get('x-wayl-signature-256');
  if (!verifyWaylWebhookSignature(rawBody, signature, config.wayl.webhookSecret)) {
    const debugId = `wayl-webhook-${randomUUID().slice(0, 8)}`;
    console.warn('[storefront-wayl-webhook] invalid signature', {
      debugId,
      bodyLength: Buffer.byteLength(rawBody),
      bodySha256: sha256Hex(rawBody),
      hasSignature: Boolean(signature),
      signatureSha256: signature ? sha256Hex(signature) : null,
    });
    return NextResponse.json({ error: 'invalid_signature', debugId }, { status: 401 });
  }
  try {
    const result = await processWaylWebhook({
      rawBody,
      signature: signature!,
      config: config as typeof config & { enabled: true; wayl: NonNullable<typeof config.wayl> },
    });
    return NextResponse.json(result, { status: result.accepted ? 200 : 400 });
  } catch {
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }
}
