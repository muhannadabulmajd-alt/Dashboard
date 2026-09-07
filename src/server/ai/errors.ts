import 'server-only';

import { aiDebugId } from './hash';

export type AiCommandFailure = {
  code: string;
  stage: string;
  fieldErrors: Record<string, string>;
  debugId: string;
  retryable: boolean;
  committed: boolean;
};

export class AiCommandError extends Error {
  readonly failure: AiCommandFailure;

  constructor(input: Omit<AiCommandFailure, 'debugId'> & { debugId?: string }) {
    super(input.code);
    this.name = 'AiCommandError';
    this.failure = {
      ...input,
      debugId: input.debugId ?? aiDebugId('ai-command'),
    };
  }
}

export function aiCommandError(
  error: unknown,
  fallback: { code: string; stage: string; retryable?: boolean; committed?: boolean },
): AiCommandError {
  if (error instanceof AiCommandError) return error;
  const raw = error instanceof Error ? error.message : fallback.code;
  const [code] = raw.split(':');
  return new AiCommandError({
    code: code || fallback.code,
    stage: fallback.stage,
    fieldErrors: {},
    retryable: fallback.retryable ?? false,
    committed: fallback.committed ?? false,
  });
}

export function actionStateError(input: {
  error?: string;
  formError?: string;
  fieldErrors?: Record<string, string>;
  stage: string;
}): AiCommandError {
  return new AiCommandError({
    code: input.formError || input.error || 'command_failed',
    stage: input.stage,
    fieldErrors: input.fieldErrors ?? {},
    retryable: false,
    committed: false,
  });
}

export function safeFailure(error: unknown): AiCommandFailure {
  return aiCommandError(error, {
    code: 'execution_failed',
    stage: 'execution',
  }).failure;
}
