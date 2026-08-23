import 'server-only';
import { send } from '@vercel/queue';

export const TELEGRAM_QUEUE_TOPIC = 'telegram-ai-updates';

export type TelegramQueuePayload = { telegramUpdateId: string };

export async function enqueueTelegramUpdate(telegramUpdateId: string): Promise<void> {
  await send<TelegramQueuePayload>(
    TELEGRAM_QUEUE_TOPIC,
    { telegramUpdateId },
    { idempotencyKey: `telegram:${telegramUpdateId}`, retentionSeconds: 7 * 24 * 60 * 60 },
  );
}
