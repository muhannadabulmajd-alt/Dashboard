import 'server-only';
import { randomBytes } from 'node:crypto';
import { ZodError } from 'zod';

export type InventoryCommandFailure = {
  code: string;
  stage: string;
  fieldErrors: Record<string, string>;
  debugId: string;
  retryable: boolean;
};

export class InventoryCommandError extends Error {
  readonly failure: InventoryCommandFailure;

  constructor(input: Omit<InventoryCommandFailure, 'debugId'> & { debugId?: string }) {
    super(input.code);
    this.name = 'InventoryCommandError';
    this.failure = {
      ...input,
      debugId: input.debugId ?? `inventory-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`,
    };
  }
}

export function inventoryCommandError(
  error: unknown,
  stage: string,
): InventoryCommandError {
  if (error instanceof InventoryCommandError) return error;
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      fieldErrors[issue.path.join('.') || 'form'] = issue.message;
    }
    return new InventoryCommandError({
      code: 'invalid_input',
      stage,
      fieldErrors,
      retryable: false,
    });
  }
  const raw = error instanceof Error ? error.message : 'inventory_command_failed';
  const [code] = raw.split(':');
  return new InventoryCommandError({
    code: code || 'inventory_command_failed',
    stage,
    fieldErrors: {},
    retryable: code === 'location_stale' || code === 'document_stale',
  });
}
