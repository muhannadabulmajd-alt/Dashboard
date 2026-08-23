import 'server-only';
import type { AiConversationChannel, Prisma } from '@prisma/client';
import {
  assistantActionCommand,
  assistantCreditUnavailableMessage,
  assistantErrorMessage,
  type AiStreamEvent,
} from '@/lib/ai-assistant';
import type { CurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';
import { cancelPendingAction, confirmPendingAction } from './actions';
import { getAiAssistantConfig } from './config';
import { aiDebugId } from './hash';
import {
  activePendingActionContext,
  getOrCreateConversation,
  recentConversationMessages,
  saveAiMessage,
} from './history';
import { runAssistant } from './orchestrator';
import { isOpenAiCreditUnavailable, safeOpenAiError, type SafeOpenAiError } from './provider-error';
import { consumeAiRateLimit } from './rate-limit';

export type AssistantMessageInput = {
  user: CurrentUser;
  locale: 'ar' | 'en';
  message: string;
  conversationId?: string;
  channel?: AiConversationChannel;
  externalThreadId?: string;
  signal?: AbortSignal;
  onEvent: (event: AiStreamEvent) => void | Promise<void>;
};

export type AssistantMessageResult = {
  conversationId: string;
  messageId?: string;
  events: AiStreamEvent[];
  failed: boolean;
  errorCode?: string;
  debugId?: string;
};

export function safeAssistantErrorCode(error: unknown, providerError: SafeOpenAiError | null): string {
  if (isOpenAiCreditUnavailable(providerError)) return 'provider_credit_unavailable';
  if (!(error instanceof Error)) return 'unknown';
  if (error.message === 'ai_key_missing') return 'not_configured';
  if (error.message === 'ai_tool_arguments_invalid') return 'tool_arguments_invalid';
  if (error.message === 'ai_tool_round_limit') return 'tool_round_limit';
  if (error.message === 'conversation_not_found') return 'conversation_not_found';
  if (error.message === 'ai_no_allowed_tools') return 'forbidden';
  return 'model_or_tool_failed';
}

function actionFailureMessage(locale: 'ar' | 'en', errorCode: string, debugId: string): string {
  if (errorCode === 'action_stale') {
    return locale === 'ar'
      ? 'تغيرت بيانات أطلس بعد المعاينة. حضّر الطلب مجدداً لمراجعة القيم الحديثة.'
      : 'Atlas data changed after the preview. Prepare the action again to review current values.';
  }
  return assistantErrorMessage(locale, debugId);
}

export async function processAssistantMessage(input: AssistantMessageInput): Promise<AssistantMessageResult> {
  await consumeAiRateLimit(input.user.id);
  const conversation = await getOrCreateConversation({
    conversationId: input.conversationId,
    userId: input.user.id,
    locale: input.locale,
    firstMessage: input.message,
    channel: input.channel ?? 'WEB',
    externalThreadId: input.externalThreadId,
  });
  const events: AiStreamEvent[] = [];
  const emit = async (event: AiStreamEvent) => {
    events.push(event);
    await input.onEvent(event);
  };

  await emit({ type: 'conversation', conversationId: conversation.id });
  const userMessage = await saveAiMessage({
    conversationId: conversation.id,
    role: 'USER',
    content: input.message,
  });

  const actionCommand = assistantActionCommand(input.message);
  if (actionCommand) {
    const pendingAction = await prisma.aiPendingAction.findFirst({
      where: {
        conversationId: conversation.id,
        userId: input.user.id,
        status: { in: ['PENDING', 'EXECUTING'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (pendingAction) {
      const debugId = aiDebugId('ai-action');
      try {
        const result = actionCommand === 'confirm'
          ? await confirmPendingAction({ actionId: pendingAction.id, user: input.user, locale: input.locale })
          : await cancelPendingAction({ actionId: pendingAction.id, user: input.user, locale: input.locale });
        await emit({
          type: 'action_result',
          actionId: result.actionId,
          status: result.status,
          message: result.message,
          href: result.href,
          invoiceHref: result.invoiceHref,
        });
        await emit({ type: 'completion', conversationId: conversation.id });
        return { conversationId: conversation.id, events, failed: false };
      } catch (error) {
        const errorCode = error instanceof Error ? error.message.split(':')[0] : 'action_failed';
        const message = actionFailureMessage(input.locale, errorCode, debugId);
        console.error('AI direct action command failed', {
          debugId,
          actionId: pendingAction.id,
          actionCommand,
          errorCode,
        });
        await emit({ type: 'error', message, debugId, retryable: errorCode !== 'action_stale' });
        await emit({ type: 'completion', conversationId: conversation.id });
        return { conversationId: conversation.id, events, failed: true, errorCode, debugId };
      }
    }
  }

  const [recentMessages, pendingContext] = await Promise.all([
    recentConversationMessages(conversation.id),
    activePendingActionContext(conversation.id),
  ]);
  const messages = pendingContext ? [pendingContext, ...recentMessages] : recentMessages;
  const config = getAiAssistantConfig();
  const requestLog = await prisma.aiRequestLog.create({
    data: {
      userId: input.user.id,
      conversationId: conversation.id,
      model: config.model,
    },
  });
  const debugId = aiDebugId('ai-chat');

  try {
    const result = await runAssistant({
      conversationId: conversation.id,
      sourceMessageId: userMessage.id,
      messages,
      user: input.user,
      locale: input.locale,
      signal: input.signal,
      hasPendingAction: Boolean(pendingContext),
      onEvent: emit,
    });
    const payload = result.events.length
      ? ({ events: result.events } as unknown as Prisma.InputJsonValue)
      : undefined;
    const kind = result.events.some((event) => event.type === 'action_preview')
      ? 'ACTION_PREVIEW'
      : result.events.some((event) => event.type === 'clarification')
        ? 'CLARIFICATION'
        : result.events.some((event) => event.type === 'result_card')
          ? 'RESULT'
          : 'TEXT';
    const message = await saveAiMessage({
      conversationId: conversation.id,
      role: 'ASSISTANT',
      kind,
      content: result.content || null,
      payload,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      requestId: result.requestId ?? undefined,
    });
    try {
      await prisma.aiRequestLog.update({
        where: { id: requestLog.id },
        data: {
          requestId: result.requestId,
          status: 'SUCCEEDED',
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.latencyMs,
        },
      });
    } catch (telemetryError) {
      console.error('AI assistant telemetry update failed', { requestLogId: requestLog.id, telemetryError });
    }
    await emit({ type: 'completion', conversationId: conversation.id, messageId: message.id });
    return { conversationId: conversation.id, messageId: message.id, events, failed: false };
  } catch (error) {
    const providerError = safeOpenAiError(error);
    const errorCode = safeAssistantErrorCode(error, providerError);
    const message = errorCode === 'provider_credit_unavailable'
      ? assistantCreditUnavailableMessage(input.locale, debugId)
      : assistantErrorMessage(input.locale, debugId);
    console.error('AI assistant request failed', {
      debugId,
      errorCode,
      requestLogId: requestLog.id,
      provider: providerError,
    });
    const saved = await Promise.allSettled([
      saveAiMessage({
        conversationId: conversation.id,
        role: 'ASSISTANT',
        kind: 'ERROR',
        content: message,
        payload: { errorCode, debugId },
      }),
      prisma.aiRequestLog.update({
        where: { id: requestLog.id },
        data: { status: 'FAILED', errorCode, latencyMs: Date.now() - requestLog.createdAt.getTime() },
      }),
    ]);
    const savedMessage = saved[0].status === 'fulfilled' ? saved[0].value : undefined;
    await emit({
      type: 'error',
      message,
      debugId,
      retryable: !['tool_arguments_invalid', 'provider_credit_unavailable', 'not_configured'].includes(errorCode),
    });
    await emit({ type: 'completion', conversationId: conversation.id, messageId: savedMessage?.id });
    return {
      conversationId: conversation.id,
      messageId: savedMessage?.id,
      events,
      failed: true,
      errorCode,
      debugId,
    };
  }
}
