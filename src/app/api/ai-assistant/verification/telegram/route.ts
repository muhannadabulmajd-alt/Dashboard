import { z } from 'zod';
import { NextResponse, type NextRequest } from 'next/server';
import { aiDebugId } from '@/server/ai/hash';
import { isHttpResponse, requireAiApiUser } from '@/server/ai/http';
import { verifyTelegramPreview } from '@/server/telegram/preview-verification';

export const runtime = 'nodejs';
export const maxDuration = 300;

const VerificationRequestSchema = z.object({
  productSku: z.string().trim().min(1).max(120),
  runId: z.string().trim().min(1).max(40),
}).strict();

export async function POST(request: NextRequest) {
  const userOrResponse = await requireAiApiUser();
  if (isHttpResponse(userOrResponse)) return userOrResponse;
  if (userOrResponse.role !== 'OWNER' || userOrResponse.email !== 'ai-phase2-preview@laheeb.test') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const parsed = VerificationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const bypassSecret = request.headers.get('x-ai-phase2-verification-bypass')?.trim();
  if (!bypassSecret) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const debugId = aiDebugId('telegram-preview');
  try {
    const result = await verifyTelegramPreview({
      previewOrigin: request.nextUrl.origin,
      bypassSecret,
      e2eUserId: userOrResponse.id,
      productSku: parsed.data.productSku,
      runId: parsed.data.runId,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const errorCode = error instanceof Error
      ? error.message.split(':')[0].slice(0, 120)
      : 'telegram_preview_verification_failed';
    console.error('Telegram isolated Preview verification failed', {
      userId: userOrResponse.id,
      debugId,
      errorCode,
    });
    return NextResponse.json({ error: 'verification_failed', errorCode, debugId }, { status: 500 });
  }
}
