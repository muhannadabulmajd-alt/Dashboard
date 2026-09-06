import { NextResponse, type NextRequest } from 'next/server';
import { AiChatRequestSchema, type AiStreamEvent } from '@/lib/ai-assistant';
import { resolveAiPageContext } from '@/lib/ai-page-context';
import { isHttpResponse, requireAiApiUser } from '@/server/ai/http';
import { AiRateLimitError } from '@/server/ai/rate-limit';
import { processAssistantMessage } from '@/server/ai/service';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const userOrResponse = await requireAiApiUser();
  if (isHttpResponse(userOrResponse)) return userOrResponse;

  const parsed = AiChatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let started = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        const send = (event: AiStreamEvent) => {
          started = true;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        try {
          await processAssistantMessage({
            user: userOrResponse,
            locale: parsed.data.locale,
            message: parsed.data.message ?? '',
            attachmentIds: parsed.data.attachmentIds,
            conversationId: parsed.data.conversationId,
            pageContext: resolveAiPageContext(parsed.data.pageContextPath) ?? undefined,
            channel: 'WEB',
            signal: request.signal,
            onEvent: send,
          });
        } catch (error) {
          if (error instanceof AiRateLimitError && !started) {
            send({
              type: 'error',
              message: parsed.data.locale === 'ar'
                ? `تم إرسال طلبات كثيرة. حاول مجدداً بعد ${error.retryAfterSeconds} ثانية.`
                : `Too many requests. Try again in ${error.retryAfterSeconds} seconds.`,
              debugId: 'rate-limited',
              retryable: true,
            });
          } else if (!started) {
            send({
              type: 'error',
              message: parsed.data.locale === 'ar'
                ? 'تعذر بدء المحادثة الآن. حاول مجدداً.'
                : 'The conversation could not be started. Try again.',
              debugId: 'conversation-start-failed',
              retryable: true,
            });
          }
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
