import OpenAI from 'openai';

export type SafeOpenAiError = {
  status: number | null;
  code: string | null;
  param: string | null;
  type: string;
  requestId: string | null;
};

export function isOpenAiCreditUnavailable(error: SafeOpenAiError | null): boolean {
  return error?.code === 'credit_balance_exhausted' || error?.code === 'insufficient_quota';
}

/** Extract only support-safe provider metadata. Never return messages, headers, bodies, or request content. */
export function safeOpenAiError(error: unknown): SafeOpenAiError | null {
  if (!(error instanceof OpenAI.APIError)) return null;
  return {
    status: error.status ?? null,
    code: typeof error.code === 'string' ? error.code : null,
    param: typeof error.param === 'string' ? error.param : null,
    type: error.constructor.name || error.name || 'APIError',
    requestId: error.requestID ?? null,
  };
}
