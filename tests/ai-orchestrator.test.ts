import { beforeEach, describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import type { AiStreamEvent } from '@/lib/ai-assistant';
import { runAssistant } from '@/server/ai/orchestrator';

function responseStream(events: unknown[], response: Record<string, unknown>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
    async finalResponse() {
      return response;
    },
  };
}

function textStream(text: string, id = 'resp_test') {
  return responseStream(
    [{ type: 'response.output_text.delta', delta: text }],
    {
      id,
      status: 'completed',
      output: [{ type: 'message', id: `msg_${id}`, role: 'assistant', status: 'completed', content: [] }],
      usage: { input_tokens: 25, output_tokens: 7 },
      error: null,
    },
  );
}

function runnerInput(onEvent = vi.fn()) {
  return {
    conversationId: 'conversation',
    sourceMessageId: 'message',
    messages: [{ role: 'user' as const, content: 'How are sales?' }],
    user: { id: 'owner', email: 'owner@laheeb.coffee', name: 'Owner', role: 'OWNER' as const, branchId: null },
    locale: 'en' as const,
    now: new Date('2026-08-13T09:00:00.000Z'),
    onEvent,
  };
}

describe('AI Responses API orchestration', () => {
  beforeEach(() => {
    process.env.AI_ASSISTANT_ENABLED = 'true';
    process.env.AI_ASSISTANT_MODEL = 'gpt-5.4-mini-2026-03-17';
  });

  it('streams with private storage, one tool at a time, and bounded output', async () => {
    const stream = vi.fn(() => textStream('Direct answer'));
    const onEvent = vi.fn();
    const result = await runAssistant(runnerInput(onEvent), {
      client: { responses: { stream } } as unknown as OpenAI,
      executeTool: vi.fn(),
    });

    expect(result.content).toBe('Direct answer');
    expect(result).toMatchObject({ model: 'gpt-5.4-mini-2026-03-17', requestId: 'resp_test', inputTokens: 25, outputTokens: 7 });
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        store: false,
        stream: true,
        parallel_tool_calls: false,
        max_output_tokens: 2_000,
        model: 'gpt-5.4-mini-2026-03-17',
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(onEvent).toHaveBeenCalledWith({ type: 'text_delta', delta: 'Direct answer' });
  });

  it('passes strict tool output into the next model round while writes remain previews', async () => {
    const actionPreview: AiStreamEvent = {
      type: 'action_preview',
      action: {
        id: 'action_1',
        type: 'CREATE_CUSTOMER',
        title: 'Create customer',
        summary: 'Review this customer before saving.',
        fields: [{ label: 'Name', value: 'Saba Al-Bayati' }],
        warnings: [],
        expiresAt: '2026-08-13T09:15:00.000Z',
        status: 'PENDING',
      },
    };
    const firstResponse = responseStream([], {
      id: 'resp_tool',
      status: 'completed',
      output: [
        {
          type: 'reasoning',
          id: 'reasoning_1',
          summary: [],
          encrypted_content: 'encrypted-reasoning-for-replay',
          created_by: 'sdk-helper-field',
        },
        {
          type: 'message',
          id: 'message_1',
          role: 'assistant',
          status: 'completed',
          content: [{
            type: 'output_text',
            text: 'I will prepare that customer.',
            annotations: [],
            logprobs: [],
            parsed: null,
          }],
        },
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'prepare_create_customer',
          arguments: JSON.stringify({ name: 'Saba Al-Bayati', phone: '07811100140' }),
          parsed_arguments: { name: 'Saba Al-Bayati', phone: '07811100140' },
          status: 'completed',
        },
      ],
      usage: { input_tokens: 40, output_tokens: 10 },
      error: null,
    });
    const stream = vi.fn()
      .mockReturnValueOnce(firstResponse)
      .mockReturnValueOnce(textStream('Review the preview and confirm it.', 'resp_final'));
    const executeTool = vi.fn().mockResolvedValue({
      modelOutput: { status: 'confirmation_required', actionId: 'action_1' },
      events: [actionPreview],
    });
    const onEvent = vi.fn();

    const result = await runAssistant(runnerInput(onEvent), {
      client: { responses: { stream } } as unknown as OpenAI,
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith(
      'prepare_create_customer',
      { name: 'Saba Al-Bayati', phone: '07811100140' },
      expect.objectContaining({ conversationId: 'conversation', sourceMessageId: 'message' }),
    );
    const secondRequest = stream.mock.calls[1][0] as { input: Array<Record<string, unknown>> };
    expect(secondRequest.input).toContainEqual(expect.objectContaining({
      type: 'reasoning',
      encrypted_content: 'encrypted-reasoning-for-replay',
    }));
    const replayedReasoning = secondRequest.input.find((item) => item.type === 'reasoning');
    expect(replayedReasoning).not.toHaveProperty('created_by');
    const replayedMessage = secondRequest.input.find((item) => item.type === 'message' && item.id === 'message_1');
    expect((replayedMessage?.content as Array<Record<string, unknown>>)[0]).not.toHaveProperty('parsed');
    const replayedCall = secondRequest.input.find((item) => item.type === 'function_call');
    expect(replayedCall).not.toHaveProperty('parsed_arguments');
    expect(secondRequest.input).toContainEqual(expect.objectContaining({
      type: 'function_call_output',
      call_id: 'call_1',
      output: JSON.stringify({ status: 'confirmation_required', actionId: 'action_1' }),
    }));
    expect(result.content).toBe('Review the preview and confirm it.');
    expect(result.events).toEqual([actionPreview]);
    expect(onEvent).toHaveBeenCalledWith(actionPreview);
  });

  it('fails closed when the model reports an incomplete response', async () => {
    const stream = vi.fn(() => responseStream([], {
      id: 'resp_incomplete',
      status: 'incomplete',
      output: [],
      usage: { input_tokens: 10, output_tokens: 0 },
      error: null,
    }));

    await expect(runAssistant(runnerInput(), {
      client: { responses: { stream } } as unknown as OpenAI,
      executeTool: vi.fn(),
    })).rejects.toThrow('ai_model_incomplete');
  });

  it('streams a model refusal as visible assistant text', async () => {
    const stream = vi.fn(() => responseStream(
      [{ type: 'response.refusal.delta', delta: 'I cannot help with that request.' }],
      {
        id: 'resp_refusal',
        status: 'completed',
        output: [{ type: 'message', id: 'msg_refusal', role: 'assistant', status: 'completed', content: [] }],
        usage: { input_tokens: 10, output_tokens: 7 },
        error: null,
      },
    ));

    const result = await runAssistant(runnerInput(), {
      client: { responses: { stream } } as unknown as OpenAI,
      executeTool: vi.fn(),
    });

    expect(result.content).toBe('I cannot help with that request.');
  });
});
