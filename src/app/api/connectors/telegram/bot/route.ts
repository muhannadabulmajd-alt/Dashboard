import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/server/db/client';
import { getTelegramBot, getTelegramWebhookInfo, registerTelegramWebhook } from '@/server/telegram/api';
import { isTelegramAdminResponse, requireTelegramAdmin } from '@/server/telegram/admin';
import { getTelegramConfig } from '@/server/telegram/config';

export const runtime = 'nodejs';

async function botStatus() {
  const config = getTelegramConfig();
  if (!config.enabled || !config.configured) {
    return { enabled: config.enabled, configured: config.configured, bot: null, webhook: null };
  }
  const [bot, webhook] = await Promise.all([getTelegramBot(), getTelegramWebhookInfo()]);
  return { enabled: config.enabled, configured: config.configured, bot, webhook };
}

export async function GET() {
  const userOrResponse = await requireTelegramAdmin();
  if (isTelegramAdminResponse(userOrResponse)) return userOrResponse;
  try {
    return NextResponse.json(await botStatus());
  } catch (error) {
    console.error('Telegram bot verification failed', { error });
    return NextResponse.json({ error: 'telegram_verification_failed' }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const userOrResponse = await requireTelegramAdmin();
  if (isTelegramAdminResponse(userOrResponse)) return userOrResponse;
  const body = await request.json().catch(() => null) as { action?: string } | null;
  if (!body || !['verify', 'register'].includes(body.action ?? '')) {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  }
  try {
    const bot = await getTelegramBot();
    if (body.action === 'register') {
      const webhookUrl = `${request.nextUrl.origin}/api/telegram/webhook`;
      await registerTelegramWebhook(webhookUrl);
      await prisma.auditLog.create({
        data: {
          userId: userOrResponse.id,
          action: 'TELEGRAM_WEBHOOK_REGISTERED',
          entity: 'TelegramBot',
          entityId: String(bot.id),
          metadata: { username: bot.username ?? null, webhookUrl, environment: process.env.VERCEL_ENV ?? 'unknown' },
        },
      });
    } else {
      await prisma.auditLog.create({
        data: {
          userId: userOrResponse.id,
          action: 'TELEGRAM_BOT_VERIFIED',
          entity: 'TelegramBot',
          entityId: String(bot.id),
          metadata: { username: bot.username ?? null, environment: process.env.VERCEL_ENV ?? 'unknown' },
        },
      });
    }
    return NextResponse.json(await botStatus());
  } catch (error) {
    console.error('Telegram bot configuration failed', { action: body.action, error });
    return NextResponse.json({ error: 'telegram_configuration_failed' }, { status: 502 });
  }
}
