import 'server-only';

import { send } from '@vercel/queue';

export const AI_REPORT_QUEUE_TOPIC = 'ai-report-delivery';

export type AiReportQueuePayload = { notificationId: string };

export async function enqueueAiReportDelivery(notificationId: string): Promise<void> {
  await send<AiReportQueuePayload>(
    AI_REPORT_QUEUE_TOPIC,
    { notificationId },
    {
      idempotencyKey: `ai-report:${notificationId}`,
      retentionSeconds: 24 * 60 * 60,
    },
  );
}
