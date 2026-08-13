import 'server-only';
import { prisma } from '@/server/db/client';
import { getAiAssistantConfig } from './config';

export class AiRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('ai_rate_limited');
  }
}

export async function consumeAiRateLimit(userId: string, now = new Date()): Promise<void> {
  const bucketStart = new Date(now);
  bucketStart.setUTCSeconds(0, 0);
  const bucket = await prisma.aiRateLimitBucket.upsert({
    where: { userId_bucketStart: { userId, bucketStart } },
    create: { userId, bucketStart, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  if (bucket.count > getAiAssistantConfig().maxRequestsPerMinute) {
    throw new AiRateLimitError(Math.max(1, 60 - now.getUTCSeconds()));
  }
}

