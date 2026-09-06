import { AI_CAPABILITIES } from '@/lib/ai-capabilities';
import { prisma } from '@/server/db/client';

export async function resetAiCapabilitiesForIntegration(): Promise<void> {
  await prisma.$transaction(
    AI_CAPABILITIES.map((capability) => prisma.aiCapabilitySetting.upsert({
      where: { capability },
      create: {
        capability,
        status: 'ENABLED',
        failureCount: 0,
        failureLimit: 1,
      },
      update: {
        status: 'ENABLED',
        failureCount: 0,
        failureLimit: 1,
        disabledReason: null,
        lastFailureAt: null,
        updatedById: null,
      },
    })),
  );
}
