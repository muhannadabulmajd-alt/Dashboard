import type { Prisma } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/server/db/client';
import { getTelegramConfig, telegramSecretMatches } from '@/server/telegram/config';
import { enqueueTelegramUpdate } from '@/server/telegram/queue';
import { supportedTelegramUpdate, TelegramUpdateSchema } from '@/server/telegram/schemas';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(request: NextRequest) {
  const config = getTelegramConfig();
  if (!config.enabled) return NextResponse.json({ ok: true, disabled: true });
  if (!config.configured) return NextResponse.json({ error: 'telegram_not_configured' }, { status: 503 });
  if (!telegramSecretMatches(request.headers.get('x-telegram-bot-api-secret-token'), config.webhookSecret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = TelegramUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: true, ignored: true });
  const supported = supportedTelegramUpdate(parsed.data);
  if (!supported?.privateChat) return NextResponse.json({ ok: true, ignored: true });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
  const receipt = await prisma.telegramUpdate.upsert({
    where: { updateId: supported.updateId },
    create: {
      updateId: supported.updateId,
      telegramUserId: String(supported.user.id),
      privateChatId: supported.chatId,
      updateType: supported.type,
      payload: parsed.data as unknown as Prisma.InputJsonValue,
      origin: request.nextUrl.origin,
      expiresAt,
    },
    update: {},
  });

  if (['QUEUED', 'PROCESSING', 'SUCCEEDED', 'IGNORED'].includes(receipt.status)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    await enqueueTelegramUpdate(receipt.id);
    await prisma.telegramUpdate.update({
      where: { id: receipt.id },
      data: { status: 'QUEUED', queuedAt: new Date(), errorCode: null },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Telegram queue publish failed', { telegramUpdateId: receipt.id, error });
    await prisma.telegramUpdate.update({
      where: { id: receipt.id },
      data: { status: 'FAILED', errorCode: 'queue_publish_failed' },
    }).catch(() => undefined);
    return NextResponse.json({ error: 'queue_unavailable' }, { status: 503 });
  }
}
