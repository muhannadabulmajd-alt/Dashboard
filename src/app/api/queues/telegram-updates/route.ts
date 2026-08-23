import { handleCallback } from '@vercel/queue';
import { processTelegramUpdate } from '@/server/telegram/processor';
import type { TelegramQueuePayload } from '@/server/telegram/queue';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = handleCallback<TelegramQueuePayload>(
  async (message) => {
    if (!message?.telegramUpdateId) throw new Error('telegram_queue_payload_invalid');
    await processTelegramUpdate(message.telegramUpdateId);
  },
  {
    visibilityTimeoutSeconds: 90,
    retry: (_error, metadata) => (
      metadata.deliveryCount >= 5
        ? { acknowledge: true }
        : { afterSeconds: Math.min(300, 15 * (2 ** Math.max(0, metadata.deliveryCount - 1))) }
    ),
  },
);
