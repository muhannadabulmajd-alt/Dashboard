'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/server/records/shared';

type ReviewAction = (previous: ActionState, formData: FormData) => Promise<ActionState>;

export function ReplenishmentReviewForm({
  action,
  status,
  version,
  idempotencyKey,
  labels,
  errors,
}: {
  action: ReviewAction;
  status: 'OPEN' | 'IN_PROGRESS';
  version: number;
  idempotencyKey: string;
  labels: {
    reason: string;
    start: string;
    cancel: string;
    saved: string;
  };
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid min-w-64 gap-2">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedRequestVersion" value={version} />
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.reason}
        <input
          name="reason"
          required
          minLength={3}
          maxLength={500}
          className="min-h-9 rounded-lg border bg-background px-2 text-sm text-foreground"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {status === 'OPEN' ? (
          <button
            type="submit"
            name="decision"
            value="START"
            disabled={pending}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {labels.start}
          </button>
        ) : null}
        <button
          type="submit"
          name="decision"
          value="CANCEL"
          disabled={pending}
          className="rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-semibold text-danger disabled:opacity-50"
        >
          {labels.cancel}
        </button>
      </div>
      {state?.ok ? <p className="text-xs font-semibold text-success">{labels.saved}</p> : null}
      {state?.error ? (
        <p className="text-xs font-semibold text-danger">
          {errors[state.error] ?? state.error}
          {state.debugId ? ` · ${state.debugId}` : ''}
        </p>
      ) : null}
    </form>
  );
}
