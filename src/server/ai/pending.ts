import 'server-only';
import { randomUUID } from 'node:crypto';
import type { AiPendingActionRisk, AiPendingActionType, Prisma } from '@prisma/client';
import type { AiActionPreview } from '@/lib/ai-assistant';
import { AI_PENDING_ACTION_MINUTES } from '@/lib/ai-assistant';
import { prisma } from '@/server/db/client';
import { preconditionHash } from './hash';

export function pendingActionExpiry(from = new Date()): Date {
  return new Date(from.getTime() + AI_PENDING_ACTION_MINUTES * 60_000);
}

export async function createPendingAction(input: {
  conversationId: string;
  userId: string;
  sourceMessageId?: string;
  type: AiPendingActionType;
  risk?: AiPendingActionRisk;
  confirmationChallenge?: string;
  extractedData: Prisma.InputJsonValue;
  validatedData: Prisma.InputJsonValue;
  preconditions: unknown;
  preview: Omit<AiActionPreview, 'id' | 'expiresAt' | 'status' | 'risk'>;
}) {
  const expiresAt = pendingActionExpiry();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-pending:${input.conversationId}`}))`;
    const conversation = await tx.aiConversation.findFirst({
      where: { id: input.conversationId, userId: input.userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!conversation) throw new Error('conversation_not_found');
    if (input.sourceMessageId) {
      const source = await tx.aiMessage.findFirst({
        where: { id: input.sourceMessageId, conversationId: input.conversationId, role: 'USER' },
        select: { id: true },
      });
      if (!source) throw new Error('source_message_invalid');
    }
    const superseded = await tx.aiPendingAction.findMany({
      where: { conversationId: input.conversationId, status: 'PENDING' },
      select: { id: true },
    });
    if (superseded.length) {
      await tx.aiPendingAction.updateMany({
        where: { id: { in: superseded.map((row) => row.id) }, status: 'PENDING' },
        data: { status: 'CANCELLED', result: { reason: 'superseded' } },
      });
    }
    const action = await tx.aiPendingAction.create({
      data: {
        conversationId: input.conversationId,
        userId: input.userId,
        sourceMessageId: input.sourceMessageId,
        type: input.type,
        risk: input.risk ?? 'MEDIUM',
        confirmationChallenge: input.confirmationChallenge,
        extractedData: input.extractedData,
        validatedData: input.validatedData,
        missingFields: [],
        preview: input.preview as unknown as Prisma.InputJsonValue,
        preconditionHash: preconditionHash(input.preconditions),
        executionKey: randomUUID(),
        expiresAt,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: 'AI_ACTION_PROPOSED',
        entity: 'AiPendingAction',
        entityId: action.id,
        metadata: {
          conversationId: input.conversationId,
          type: input.type,
          expiresAt: expiresAt.toISOString(),
          supersededActionIds: superseded.map((row) => row.id),
        },
      },
    });
    return {
      ...action,
      clientPreview: {
        ...input.preview,
        id: action.id,
        risk: action.risk,
        expiresAt: expiresAt.toISOString(),
        status: action.status,
      } satisfies AiActionPreview,
    };
  });
}
