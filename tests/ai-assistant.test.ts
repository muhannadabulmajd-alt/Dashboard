import { describe, expect, it } from 'vitest';
import { AI_EVALUATION_CASES } from '@/lib/ai-evaluations';
import {
  AI_CONTEXT_MESSAGE_LIMIT,
  AI_MESSAGE_MAX_LENGTH,
  AI_PENDING_ACTION_MINUTES,
  AI_TOOL_ROUND_LIMIT,
  AiChatRequestSchema,
  normalizeAssistantText,
} from '@/lib/ai-assistant';
import { normalizeIraqiPhone } from '@/lib/phone';
import { can } from '@/lib/rbac';
import { parseBaghdadDateTime } from '@/lib/dates';
import OpenAI from 'openai';
import { safeOpenAiError } from '@/server/ai/provider-error';

describe('Atlas AI assistant contracts', () => {
  it('restricts the assistant capability to Owner and Admin', () => {
    expect(can('OWNER', 'use:ai-assistant')).toBe(true);
    expect(can('ADMIN', 'use:ai-assistant')).toBe(true);
    expect(can('FINANCE', 'use:ai-assistant')).toBe(false);
    expect(can('SALES_CRM', 'use:ai-assistant')).toBe(false);
    expect(can('VIEWER', 'use:ai-assistant')).toBe(false);
  });

  it('normalizes common Iraqi phone representations to one value', () => {
    const variants = ['07811100140', '9647811100140', '+964 781 110 0140', '00964-781-110-0140'];
    expect(new Set(variants.map(normalizeIraqiPhone))).toEqual(new Set(['+9647811100140']));
    expect(normalizeIraqiPhone('')).toBeNull();
  });

  it('normalizes Arabic spelling variants for operational matching', () => {
    expect(normalizeAssistantText('أُمَنيّة')).toBe(normalizeAssistantText('امنيه'));
    expect(normalizeAssistantText('  Hi-Express  ')).toBe('hi express');
  });

  it('interprets naive operational dates in Baghdad time', () => {
    expect(parseBaghdadDateTime('2026-08-13')?.toISOString()).toBe('2026-08-12T21:00:00.000Z');
    expect(parseBaghdadDateTime('2026-08-13T12:30:00')?.toISOString()).toBe('2026-08-13T09:30:00.000Z');
    expect(parseBaghdadDateTime('2026-08-13T12:30:00Z')?.toISOString()).toBe('2026-08-13T12:30:00.000Z');
  });

  it('accepts only strict, bounded chat requests', () => {
    expect(AiChatRequestSchema.parse({ message: 'مرحبا', locale: 'ar' })).toEqual({ message: 'مرحبا', locale: 'ar' });
    expect(() => AiChatRequestSchema.parse({ message: 'hello', locale: 'en', injected: true })).toThrow();
    expect(() => AiChatRequestSchema.parse({ message: 'x'.repeat(AI_MESSAGE_MAX_LENGTH + 1), locale: 'en' })).toThrow();
  });

  it('keeps launch safety limits pinned', () => {
    expect(AI_CONTEXT_MESSAGE_LIMIT).toBe(12);
    expect(AI_TOOL_ROUND_LIMIT).toBe(4);
    expect(AI_PENDING_ACTION_MINUTES).toBe(15);
  });

  it('logs only support-safe OpenAI error metadata', () => {
    const error = new OpenAI.BadRequestError(
      400,
      { message: 'sensitive provider detail', type: 'invalid_request_error', code: 'invalid_parameter' },
      'sensitive provider detail',
      new Headers({ authorization: 'Bearer secret' }),
    );
    Object.defineProperty(error, 'requestID', { value: 'req_safe_123' });

    expect(safeOpenAiError(error)).toEqual({
      status: 400,
      code: 'invalid_parameter',
      type: 'BadRequestError',
      requestId: 'req_safe_123',
    });
    expect(JSON.stringify(safeOpenAiError(error))).not.toContain('sensitive provider detail');
    expect(JSON.stringify(safeOpenAiError(error))).not.toContain('secret');
    expect(safeOpenAiError(new Error('ordinary error'))).toBeNull();
  });

  it('covers bilingual, Iraqi, mixed, unsupported, and confirmation-bypass evaluations', () => {
    expect(new Set(AI_EVALUATION_CASES.map((row) => row.language))).toEqual(new Set(['en', 'ar', 'iqi', 'mixed']));
    expect(AI_EVALUATION_CASES.filter((row) => row.intent === 'write').every((row) => row.requiresConfirmation && row.expectedTool?.startsWith('prepare_'))).toBe(true);
    expect(AI_EVALUATION_CASES.some((row) => row.id === 'safety-bypass')).toBe(true);
    expect(AI_EVALUATION_CASES.some((row) => row.intent === 'unsupported')).toBe(true);
  });
});
