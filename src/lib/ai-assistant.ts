import { z } from 'zod';

export const AI_MESSAGE_MAX_LENGTH = 4_000;
export const AI_CONTEXT_MESSAGE_LIMIT = 12;
export const AI_TOOL_ROUND_LIMIT = 4;
export const AI_PENDING_ACTION_MINUTES = 15;

export const AiChatRequestSchema = z.object({
  conversationId: z.string().cuid().optional(),
  message: z.string().trim().min(1).max(AI_MESSAGE_MAX_LENGTH),
  locale: z.enum(['ar', 'en']),
}).strict();

export type AiResultMetric = {
  label: string;
  value: string | number;
  hint?: string;
};

export type AiResultRow = {
  id: string;
  title: string;
  subtitle?: string;
  value?: string | number;
  href?: string;
};

export type AiResultCard = {
  title: string;
  answer?: string;
  period?: string;
  generatedAt: string;
  metrics?: AiResultMetric[];
  rows?: AiResultRow[];
  href?: string;
};

export type AiClarification = {
  message: string;
  field?: string;
  choices?: Array<{ id: string; label: string; value: string; detail?: string }>;
};

export type AiActionPreview = {
  id: string;
  type: string;
  title: string;
  summary: string;
  fields: Array<{ label: string; value: string }>;
  warnings: string[];
  expiresAt: string;
  status: string;
};

export type AiStreamEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'clarification'; clarification: AiClarification }
  | { type: 'result_card'; card: AiResultCard }
  | { type: 'action_preview'; action: AiActionPreview }
  | { type: 'action_result'; actionId: string; status: string; message: string; href?: string }
  | { type: 'error'; message: string; debugId: string; retryable: boolean }
  | { type: 'completion'; conversationId: string; messageId?: string };

export function normalizeAssistantText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ar-IQ')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function assistantErrorMessage(locale: 'ar' | 'en', debugId: string): string {
  return locale === 'ar'
    ? `تعذر إكمال الطلب الآن. لم يتم تغيير أي بيانات. رمز المتابعة: ${debugId}`
    : `I could not complete that request. No data was changed. Debug ID: ${debugId}`;
}

export function assistantCreditUnavailableMessage(locale: 'ar' | 'en', debugId: string): string {
  return locale === 'ar'
    ? `رصيد OpenAI API للمساعد غير متاح حالياً. لم يتم تغيير أي بيانات. اطلب من المالك إضافة رصيد API. رمز المتابعة: ${debugId}`
    : `The AI Assistant's OpenAI API balance is unavailable. No data was changed. Ask an Owner to add API credit. Debug ID: ${debugId}`;
}
