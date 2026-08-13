import 'server-only';
import { NextResponse } from 'next/server';
import { aiDebugId } from './hash';

type ActionErrorResponse = {
  status: number;
  body: {
    error: string;
    message: string;
    debugId?: string;
    retryable: boolean;
  };
};

function localized(locale: 'ar' | 'en', en: string, ar: string): string {
  return locale === 'ar' ? ar : en;
}

export function pendingActionError(error: unknown, locale: 'ar' | 'en'): ActionErrorResponse {
  const code = error instanceof Error ? error.message : 'unknown';
  if (code === 'notfound') {
    return { status: 404, body: { error: code, message: localized(locale, 'Action not found.', 'لم يتم العثور على الإجراء.'), retryable: false } };
  }
  if (code === 'action_expired') {
    return { status: 410, body: { error: code, message: localized(locale, 'This preview expired. Ask the assistant to prepare it again.', 'انتهت صلاحية هذه المعاينة. اطلب من المساعد إعدادها من جديد.'), retryable: true } };
  }
  if (code === 'action_stale') {
    return { status: 409, body: { error: code, message: localized(locale, 'Atlas data changed after the preview. Prepare it again to review fresh values.', 'تغيرت بيانات أطلس بعد المعاينة. أعد إعدادها لمراجعة القيم الجديدة.'), retryable: true } };
  }
  if (code === 'action_in_progress') {
    return { status: 409, body: { error: code, message: localized(locale, 'This action is already being processed.', 'هذا الإجراء قيد التنفيذ حالياً.'), retryable: true } };
  }
  if (code.startsWith('action_') && !code.startsWith('action_failed:')) {
    return { status: 409, body: { error: code, message: localized(locale, 'This action is no longer available.', 'لم يعد هذا الإجراء متاحاً.'), retryable: false } };
  }
  const debugId = code.startsWith('action_failed:') ? code.slice('action_failed:'.length) : aiDebugId('ai-action');
  return {
    status: 500,
    body: {
      error: 'action_failed',
      message: localized(locale, `The action could not be completed. No partial change was kept. Debug ID: ${debugId}`, `تعذر تنفيذ الإجراء ولم يتم الاحتفاظ بأي تغيير جزئي. رمز المتابعة: ${debugId}`),
      debugId,
      retryable: false,
    },
  };
}

export function actionErrorResponse(error: unknown, locale: 'ar' | 'en'): NextResponse {
  const mapped = pendingActionError(error, locale);
  return NextResponse.json(mapped.body, { status: mapped.status });
}
