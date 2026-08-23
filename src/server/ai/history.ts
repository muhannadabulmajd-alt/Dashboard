import 'server-only';
import type { AiConversationChannel, AiMessageKind, AiMessageRole, Prisma } from '@prisma/client';
import { AI_CONTEXT_MESSAGE_LIMIT, safeAssistantNarrative } from '@/lib/ai-assistant';
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
  channel?: AiConversationChannel;
  externalThreadId?: string;
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
  if (input.channel === 'TELEGRAM' && input.externalThreadId) {
    const existing = await prisma.aiConversation.findFirst({
      where: {
        userId: input.userId,
        channel: 'TELEGRAM',
        externalThreadId: input.externalThreadId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
    if (existing) {
      return prisma.aiConversation.update({
        where: { id: existing.id },
        data: { locale: input.locale, lastMessageAt: new Date() },
      });
    }
  }
  return prisma.aiConversation.create({
    data: {
      userId: input.userId,
      locale: input.locale,
      title: input.firstMessage.slice(0, 80),
      channel: input.channel ?? 'WEB',
      externalThreadId: input.externalThreadId,
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
    const payload = message.payload && typeof message.payload === 'object'
      ? message.payload as { events?: Array<Record<string, unknown>>; actionResult?: Record<string, unknown> }
      : null;
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const hasUnverifiedPreview = events.some((event) => event.type === 'action_preview')
      && !events.some((event) => event.type === 'action_result' && event.status === 'EXECUTED');
    const visibleContent = message.role === 'ASSISTANT' && hasUnverifiedPreview && message.content
      ? safeAssistantNarrative(message.content, {
          pendingWrite: true,
          locale: /[\u0600-\u06FF]/.test(message.content) ? 'ar' : 'en',
        })
      : message.content;
    const eventContext = events.length
      ? events.flatMap((event) => {
          if (event.type === 'action_preview' && event.action && typeof event.action === 'object') {
            const action = event.action as Record<string, unknown>;
            return [`Atlas proposed action ${String(action.id ?? '')} (${String(action.type ?? '')}) is ${String(action.status ?? 'PENDING')} and has not been executed.`];
          }
          if (event.type === 'action_result') {
            return [`Verified Atlas action result: ${String(event.message ?? event.status ?? '')}`];
          }
          if (event.type === 'result_card' && event.card && typeof event.card === 'object') {
            const card = event.card as Record<string, unknown>;
            return [`Atlas result: ${String(card.title ?? '')}. ${String(card.answer ?? '')}`.trim()];
          }
          if (event.type === 'clarification' && event.clarification && typeof event.clarification === 'object') {
            const clarification = event.clarification as Record<string, unknown>;
            return [`Atlas requested clarification: ${String(clarification.message ?? '')}`];
          }
          return [];
        }).join('\n')
      : '';
    const storedResult = payload?.actionResult
      ? `Verified Atlas action result: ${String(payload.actionResult.message ?? payload.actionResult.status ?? '')}`
      : '';
    const content = [visibleContent, eventContext, storedResult]
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
    select: { id: true, type: true, preview: true, expiresAt: true, status: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!action) return null;
  const preview = action.preview && typeof action.preview === 'object'
    ? action.preview as Record<string, unknown>
    : {};
  return {
    role: 'assistant' as const,
    content: [
      `Current Atlas action ${action.id} (${action.type}) is ${action.status} and has not been executed.`,
      `Preview: ${String(preview.summary ?? preview.title ?? action.type)}.`,
      `It expires at ${action.expiresAt.toISOString()}.`,
    ].join(' '),
  };
}
