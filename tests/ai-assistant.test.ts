import { describe, expect, it } from 'vitest';
import { AI_EVALUATION_CASES } from '@/lib/ai-evaluations';
import {
  AI_CONTEXT_MESSAGE_LIMIT,
  AI_MESSAGE_MAX_LENGTH,
  AI_PENDING_ACTION_MINUTES,
  AI_TOOL_ROUND_LIMIT,
  AiChatRequestSchema,
  assistantActionCommand,
  assistantCreditUnavailableMessage,
  normalizeAssistantText,
  safeAssistantNarrative,
} from '@/lib/ai-assistant';
import { normalizeIraqiPhone } from '@/lib/phone';
import { can } from '@/lib/rbac';
import { parseBaghdadDateTime } from '@/lib/dates';
import { resolveAiPageContext } from '@/lib/ai-page-context';
import OpenAI from 'openai';
import { isOpenAiCreditUnavailable, safeOpenAiError } from '@/server/ai/provider-error';

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
    expect(normalizeAssistantText('قُوجي ٢٥٠ غرام')).toBe('قوجي 250 غرام');
    expect(normalizeAssistantText('كیف ۲۲۵')).toBe('كيف 225');
  });

  it('routes deliberate confirmation and cancellation commands without another model call', () => {
    expect(assistantActionCommand('confirm')).toBe('confirm');
    expect(assistantActionCommand('تأكيد')).toBe('confirm');
    expect(assistantActionCommand('صحيح')).toBe('confirm');
    expect(assistantActionCommand('إلغاء')).toBe('cancel');
    expect(assistantActionCommand('yes, but change the quantity')).toBeNull();
  });

  it('does not allow model prose to claim an unconfirmed write succeeded', () => {
    expect(safeAssistantNarrative('Order LHB-1 was created.', { pendingWrite: true, locale: 'en' }))
      .toContain('No data has changed yet');
    expect(safeAssistantNarrative('تم إنشاء الطلب.', { pendingWrite: true, locale: 'ar' }))
      .toContain('لم يتم تغيير أي بيانات');
    expect(safeAssistantNarrative('Sales are IQD 20,000.', { pendingWrite: false, locale: 'en' }))
      .toBe('Sales are IQD 20,000.');
  });

  it('interprets naive operational dates in Baghdad time', () => {
    expect(parseBaghdadDateTime('2026-08-13')?.toISOString()).toBe('2026-08-12T21:00:00.000Z');
    expect(parseBaghdadDateTime('2026-08-13T12:30:00')?.toISOString()).toBe('2026-08-13T09:30:00.000Z');
    expect(parseBaghdadDateTime('2026-08-13T12:30:00Z')?.toISOString()).toBe('2026-08-13T12:30:00.000Z');
  });

  it('accepts only strict, bounded chat requests', () => {
    expect(AiChatRequestSchema.parse({ message: 'مرحبا', locale: 'ar' })).toEqual({ message: 'مرحبا', locale: 'ar' });
    expect(AiChatRequestSchema.parse({
      message: 'Summarize this page',
      locale: 'en',
      pageContextPath: '/sales?range=this_month',
    })).toMatchObject({ pageContextPath: '/sales?range=this_month' });
    expect(() => AiChatRequestSchema.parse({ message: 'hello', locale: 'en', injected: true })).toThrow();
    expect(() => AiChatRequestSchema.parse({
      message: 'hello',
      locale: 'en',
      pageContextPath: 'https://attacker.example/orders',
    })).toThrow();
    expect(() => AiChatRequestSchema.parse({ message: 'x'.repeat(AI_MESSAGE_MAX_LENGTH + 1), locale: 'en' })).toThrow();
  });

  it('normalizes local page context and strips unapproved query values', () => {
    expect(resolveAiPageContext('/ar/admin/records/orders/order_1?token=secret&status=PENDING&range=7d')).toEqual({
      path: '/admin/records/orders/order_1?range=7d&status=PENDING',
      section: 'orders',
    });
    expect(resolveAiPageContext('//attacker.example/sales')).toBeNull();
    expect(resolveAiPageContext('/login')).toBeNull();
    expect(resolveAiPageContext('/ai-assistant')).toBeNull();
  });

  it('keeps launch safety limits pinned', () => {
    expect(AI_CONTEXT_MESSAGE_LIMIT).toBe(12);
    expect(AI_TOOL_ROUND_LIMIT).toBe(4);
    expect(AI_PENDING_ACTION_MINUTES).toBe(15);
  });

  it('logs only support-safe OpenAI error metadata', () => {
    const error = new OpenAI.BadRequestError(
      400,
      { message: 'sensitive provider detail', type: 'invalid_request_error', code: 'invalid_parameter', param: 'include[0]' },
      'sensitive provider detail',
      new Headers({ authorization: 'Bearer secret' }),
    );
    Object.defineProperty(error, 'requestID', { value: 'req_safe_123' });

    expect(safeOpenAiError(error)).toEqual({
      status: 400,
      code: 'invalid_parameter',
      param: 'include[0]',
      type: 'BadRequestError',
      requestId: 'req_safe_123',
    });
    expect(JSON.stringify(safeOpenAiError(error))).not.toContain('sensitive provider detail');
    expect(JSON.stringify(safeOpenAiError(error))).not.toContain('secret');
    expect(safeOpenAiError(new Error('ordinary error'))).toBeNull();
  });

  it('identifies unavailable provider credit without exposing provider details', () => {
    expect(isOpenAiCreditUnavailable({
      status: null,
      code: 'credit_balance_exhausted',
      param: null,
      type: 'APIError',
      requestId: 'req_safe_456',
    })).toBe(true);
    expect(isOpenAiCreditUnavailable({
      status: 400,
      code: 'invalid_parameter',
      param: null,
      type: 'BadRequestError',
      requestId: 'req_safe_789',
    })).toBe(false);
    expect(assistantCreditUnavailableMessage('en', 'debug-safe')).toContain('No data was changed');
    expect(assistantCreditUnavailableMessage('ar', 'debug-safe')).toContain('لم يتم تغيير أي بيانات');
  });

  it('covers bilingual, Iraqi, mixed, unsupported, and confirmation-bypass evaluations', () => {
    expect(new Set(AI_EVALUATION_CASES.map((row) => row.language))).toEqual(new Set(['en', 'ar', 'iqi', 'mixed']));
    expect(AI_EVALUATION_CASES.filter((row) => row.intent === 'write').every((row) => row.requiresConfirmation && row.expectedTool?.startsWith('prepare_'))).toBe(true);
    expect(AI_EVALUATION_CASES.some((row) => row.id === 'safety-bypass')).toBe(true);
    expect(AI_EVALUATION_CASES.some((row) => row.intent === 'unsupported')).toBe(true);
  });
});
