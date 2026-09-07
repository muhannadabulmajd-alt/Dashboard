const TERMINAL_TELEGRAM_PROCESSING_ERRORS = new Set([
  'action_cancelled',
  'action_expired',
  'action_failed',
  'action_not_pending',
  'action_stale',
  'ai_capability_unavailable',
  'ai_tool_forbidden',
  'attachment_count_exceeded',
  'attachment_empty',
  'attachment_mime_mismatch',
  'attachment_not_audio',
  'attachment_not_found',
  'attachment_too_large',
  'attachment_total_too_large',
  'attachment_type_unsupported',
  'notfound',
  'transcription_empty',
]);

export function telegramProcessingErrorMessage(
  locale: 'ar' | 'en',
  errorCode: string,
  debugId: string,
): string {
  if (errorCode === 'ai_capability_unavailable') {
    return locale === 'ar'
      ? `قدرة المساعد المطلوبة، مثل الصوت أو المرفقات، متوقفة مؤقتاً. لم تتغير أي بيانات. اطلب من المالك مراجعة ضوابط الإصدار. رمز المتابعة: ${debugId}`
      : `The required assistant capability, such as voice or attachments, is temporarily paused. No data was changed. Ask an Owner to review the release controls. Debug ID: ${debugId}`;
  }
  if (errorCode === 'attachment_too_large' || errorCode === 'attachment_total_too_large') {
    return locale === 'ar'
      ? `حجم المرفق يتجاوز الحد المسموح. لم تتغير أي بيانات. أرسل ملفاً أصغر. رمز المتابعة: ${debugId}`
      : `The attachment exceeds the allowed size. No data was changed. Send a smaller file. Debug ID: ${debugId}`;
  }
  if (errorCode.startsWith('attachment_')) {
    return locale === 'ar'
      ? `تعذر قبول المرفق لأنه فارغ أو غير مدعوم أو لا يطابق نوع الملف المعلن. لم تتغير أي بيانات. رمز المتابعة: ${debugId}`
      : `The attachment could not be accepted because it is empty, unsupported, or does not match its declared type. No data was changed. Debug ID: ${debugId}`;
  }
  return locale === 'ar'
    ? `تعذر إكمال الطلب الآن. لم تتغير أي بيانات. رمز المتابعة: ${debugId}`
    : `The request could not be completed. No data was changed. Debug ID: ${debugId}`;
}

export function shouldRetryTelegramProcessing(error: unknown): boolean {
  if (error && typeof error === 'object' && 'retryable' in error) {
    return (error as { retryable?: unknown }).retryable === true;
  }
  const code = error instanceof Error ? error.message.split(':')[0] : 'telegram_processing_failed';
  return !TERMINAL_TELEGRAM_PROCESSING_ERRORS.has(code);
}
