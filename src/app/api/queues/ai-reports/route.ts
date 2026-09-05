import { handleCallback } from '@vercel/queue';
import { z } from 'zod';
import { processAiReportNotification } from '@/server/ai/reports';

export const runtime = 'nodejs';
export const maxDuration = 60;

const PayloadSchema = z.object({ notificationId: z.string().cuid() }).strict();

export const POST = handleCallback(async (payload: unknown) => {
  const parsed = PayloadSchema.parse(payload);
  await processAiReportNotification(parsed.notificationId);
}, {
  visibilityTimeoutSeconds: 90,
  retry: (_error, metadata) => (
    metadata.deliveryCount >= 6
      ? { acknowledge: true }
      : { afterSeconds: Math.min(900, 30 * (2 ** Math.max(0, metadata.deliveryCount - 1))) }
  ),
});
