import 'server-only';
import type { AiMessageKind, AiMessageRole, Prisma } from '@prisma/client';
import { AI_CONTEXT_MESSAGE_LIMIT } from '@/lib/ai-assistant';
import { prisma } from '@/server/db/client';
import { getAiAssistantConfig } from './config';

export function conversationExpiry(from = new Date()): Date {
  const expiry = new Date(from);
  expiry.setUTCDate(expiry.getUTCDate() + getAiAssistantConfig().historyRetentionDays);
  return expiry;
}

export async function getOrCreateConversation(input: {
  conversationId?: string;
  userId: string;
  locale: 'ar' | 'en';
  firstMessage: string;
}) {
  if (input.conversationId) {
    const conversation = await prisma.aiConversation.findFirst({
      where: {
        id: input.conversationId,
        userId: input.userId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
    });
    if (!conversation) throw new Error('conversation_not_found');
    return prisma.aiConversation.update({
      where: { id: conversation.id },
      data: {
        locale: input.locale,
        lastMessageAt: new Date(),
      },
    });
  }
  return prisma.aiConversation.create({
    data: {
      userId: input.userId,
      locale: input.locale,
      title: input.firstMessage.slice(0, 80),
      expiresAt: conversationExpiry(),
    },
  });
}

export async function saveAiMessage(input: {
  conversationId: string;
  role: AiMessageRole;
  kind?: AiMessageKind;
  content?: string | null;
  payload?: Prisma.InputJsonValue;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  requestId?: string;
}) {
  const message = await prisma.aiMessage.create({
    data: {
      conversationId: input.conversationId,
      role: input.role,
      kind: input.kind ?? 'TEXT',
      content: input.content ?? null,
      payload: input.payload,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      requestId: input.requestId,
    },
  });
  await prisma.aiConversation.update({
    where: { id: input.conversationId },
    data: { lastMessageAt: new Date() },
  });
  return message;
}

export async function recentConversationMessages(conversationId: string) {
  const rows = await prisma.aiMessage.findMany({
    where: { conversationId, role: { in: ['USER', 'ASSISTANT'] } },
    orderBy: { createdAt: 'desc' },
    take: AI_CONTEXT_MESSAGE_LIMIT,
    select: { role: true, content: true, payload: true },
  });
  return rows.reverse().flatMap((message) => {
    const visiblePayload = message.payload && typeof message.payload === 'object'
      ? JSON.stringify(message.payload).slice(0, 6_000)
      : '';
    const content = [message.content, visiblePayload ? `Visible Atlas card data: ${visiblePayload}` : '']
      .filter(Boolean)
      .join('\n');
    return content
      ? [{ role: message.role === 'USER' ? 'user' as const : 'assistant' as const, content }]
      : [];
  });
}

export async function activePendingActionContext(conversationId: string) {
  const action = await prisma.aiPendingAction.findFirst({
    where: { conversationId, status: 'PENDING', expiresAt: { gt: new Date() } },
    select: { type: true, preview: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!action) return null;
  return {
    role: 'assistant' as const,
    content: `Current unconfirmed Atlas action context: ${JSON.stringify(action).slice(0, 10_000)}`,
  };
}
