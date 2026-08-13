import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { AiChatRequestSchema, assistantErrorMessage, type AiStreamEvent } from '@/lib/ai-assistant';
import { prisma } from '@/server/db/client';
import { aiDebugId } from '@/server/ai/hash';
import { getAiAssistantConfig } from '@/server/ai/config';
import { activePendingActionContext, getOrCreateConversation, recentConversationMessages, saveAiMessage } from '@/server/ai/history';
import { isHttpResponse, requireAiApiUser } from '@/server/ai/http';
import { runAssistant } from '@/server/ai/orchestrator';
import { safeOpenAiError } from '@/server/ai/provider-error';
import { AiRateLimitError, consumeAiRateLimit } from '@/server/ai/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

function safeErrorCode(error: unknown): string {
  if (error instanceof AiRateLimitError) return 'rate_limited';
  if (!(error instanceof Error)) return 'unknown';
  if (error.message === 'ai_key_missing') return 'not_configured';
  if (error.message === 'ai_tool_arguments_invalid') return 'tool_arguments_invalid';
  if (error.message === 'ai_tool_round_limit') return 'tool_round_limit';
  if (error.message === 'conversation_not_found') return 'conversation_not_found';
  return 'model_or_tool_failed';
}

export async function POST(request: NextRequest) {
  const userOrResponse = await requireAiApiUser();
  if (isHttpResponse(userOrResponse)) return userOrResponse;

  const parsed = AiChatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    await consumeAiRateLimit(userOrResponse.id);
  } catch (error) {
    if (error instanceof AiRateLimitError) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(error.retryAfterSeconds) } },
      );
    }
    throw error;
  }

  let conversation;
  try {
    conversation = await getOrCreateConversation({
      conversationId: parsed.data.conversationId,
      userId: userOrResponse.id,
      locale: parsed.data.locale,
      firstMessage: parsed.data.message,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'conversation_not_found') {
      return NextResponse.json({ error: 'conversation_not_found' }, { status: 404 });
    }
    throw error;
  }

  const userMessage = await saveAiMessage({
    conversationId: conversation.id,
    role: 'USER',
    content: parsed.data.message,
  });
  const [recentMessages, pendingContext] = await Promise.all([
    recentConversationMessages(conversation.id),
    activePendingActionContext(conversation.id),
  ]);
  const messages = pendingContext ? [pendingContext, ...recentMessages] : recentMessages;
  const config = getAiAssistantConfig();
  const requestLog = await prisma.aiRequestLog.create({
    data: {
      userId: userOrResponse.id,
      conversationId: conversation.id,
      model: config.model,
    },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: AiStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      void (async () => {
        const debugId = aiDebugId('ai-chat');
        try {
          send({ type: 'conversation', conversationId: conversation.id });
          const result = await runAssistant({
            conversationId: conversation.id,
            sourceMessageId: userMessage.id,
            messages,
            user: userOrResponse,
            locale: parsed.data.locale,
            signal: request.signal,
            onEvent: send,
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
          send({ type: 'completion', conversationId: conversation.id, messageId: message.id });
        } catch (error) {
          const errorCode = safeErrorCode(error);
          const message = assistantErrorMessage(parsed.data.locale, debugId);
          console.error('AI assistant request failed', {
            debugId,
            errorCode,
            requestLogId: requestLog.id,
            provider: safeOpenAiError(error),
          });
          await Promise.allSettled([
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
          send({ type: 'error', message, debugId, retryable: errorCode !== 'tool_arguments_invalid' });
          send({ type: 'completion', conversationId: conversation.id });
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
