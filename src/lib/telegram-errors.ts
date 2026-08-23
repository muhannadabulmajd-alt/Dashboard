const TERMINAL_TELEGRAM_PROCESSING_ERRORS = new Set([
  'action_cancelled',
  'action_expired',
  'action_failed',
  'action_not_pending',
  'action_stale',
  'notfound',
]);

export function shouldRetryTelegramProcessing(error: unknown): boolean {
  if (error && typeof error === 'object' && 'retryable' in error) {
    return (error as { retryable?: unknown }).retryable === true;
  }
  const code = error instanceof Error ? error.message.split(':')[0] : 'telegram_processing_failed';
  return !TERMINAL_TELEGRAM_PROCESSING_ERRORS.has(code);
}
