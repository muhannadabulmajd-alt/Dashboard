import { z } from 'zod';
import { AiPageContextPathSchema } from './ai-page-context';

export const AI_MESSAGE_MAX_LENGTH = 4_000;
export const AI_CONTEXT_MESSAGE_LIMIT = 12;
export const AI_TOOL_ROUND_LIMIT = 4;
export const AI_PENDING_ACTION_MINUTES = 15;
export const AI_ATTACHMENT_MAX_COUNT = 4;

export const AiChatRequestSchema = z.object({
  conversationId: z.string().cuid().optional(),
  message: z.string().trim().max(AI_MESSAGE_MAX_LENGTH).optional(),
  attachmentIds: z.array(z.string().cuid()).max(AI_ATTACHMENT_MAX_COUNT).optional(),
  pageContextPath: AiPageContextPathSchema.optional(),
  locale: z.enum(['ar', 'en']),
}).strict().refine((data) => Boolean(data.message || data.attachmentIds?.length), {
  message: 'A message or attachment is required.',
  path: ['message'],
});

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

export type AiResultDownload = {
  format: 'PDF' | 'XLSX' | 'CSV';
  href: string;
};

export type AiResultCard = {
  title: string;
  answer?: string;
  period?: string;
  generatedAt: string;
  metrics?: AiResultMetric[];
  rows?: AiResultRow[];
  href?: string;
  reportId?: string;
  downloads?: AiResultDownload[];
};

export type AiClarification = {
  message: string;
  field?: string;
  choices?: Array<{ id: string; label: string; value: string; detail?: string }>;
};

export type AiActionPreview = {
  id: string;
  type: string;
  risk: 'MEDIUM' | 'HIGH';
  title: string;
  summary: string;
  fields: Array<{ label: string; value: string }>;
  warnings: string[];
  confirmationChallenge?: string;
  expiresAt: string;
  status: string;
};

export type AiStreamEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'clarification'; clarification: AiClarification }
  | { type: 'result_card'; card: AiResultCard }
  | { type: 'action_preview'; action: AiActionPreview }
  | {
      type: 'action_result';
      actionId: string;
      status: string;
      message: string;
      href?: string;
      invoiceHref?: string;
      documentHref?: string;
      documentStatus?: 'READY' | 'PENDING';
      committed?: boolean;
      requiresSecondConfirmation?: boolean;
      confirmationChallenge?: string;
    }
  | { type: 'error'; message: string; debugId: string; retryable: boolean }
  | { type: 'completion'; conversationId: string; messageId?: string };

export function normalizeAssistantText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ar-IQ')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ي')
    .replace(/[ک]/g, 'ك')
    .replace(/[ی]/g, 'ي')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export type AssistantActionCommand = 'confirm' | 'cancel';

/** Recognize a deliberate confirmation/cancellation without another model call. */
export function assistantActionCommand(value: string): AssistantActionCommand | null {
  const normalized = normalizeAssistantText(value);
  const confirmations = new Set([
    'confirm',
    'confirm and execute',
    'execute',
    'yes confirm',
    'yes execute',
    'تاكيد',
    'اكد',
    'اكد ونفذ',
    'نفذ',
    'نعم اكد',
    'صحيح',
  ]);
  if (confirmations.has(normalized)) return 'confirm';
  const cancellations = new Set([
    'cancel',
    'cancel action',
    'do not execute',
    'الغاء',
    'الغي',
    'لا تنفذ',
  ]);
  return cancellations.has(normalized) ? 'cancel' : null;
}

export function safeAssistantNarrative(
  content: string,
  input: { pendingWrite: boolean; locale: 'ar' | 'en' },
): string {
  if (!input.pendingWrite) return content.trim();
  const normalized = normalizeAssistantText(content);
  const claimsMutation = [
    'was created',
    'was updated',
    'was recorded',
    'has been created',
    'has been updated',
    'تم انشاء',
    'تم تحديث',
    'تم تسجيل',
    'تم تنفيذ',
  ].some((phrase) => normalized.includes(normalizeAssistantText(phrase)));
  if (!claimsMutation) return content.trim();
  return input.locale === 'ar'
    ? 'الإجراء جاهز للمراجعة، ولم يتم تغيير أي بيانات بعد. استخدم زر التأكيد لتنفيذه.'
    : 'The action is ready for review. No data has changed yet; use Confirm to execute it.';
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
