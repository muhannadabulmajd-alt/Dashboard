'use client';

import { useActionState, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import type { ActionState } from '@/server/records/shared';

const input = 'min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

export function StockDocumentReversalForm({
  action,
  locale,
  documentNumber,
  occurredAt,
  idempotencyKey,
  expectedDocumentVersion,
  expectedLocationVersions,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  documentNumber: string;
  occurredAt: string;
  idempotencyKey: string;
  expectedDocumentVersion: number;
  expectedLocationVersions: Array<{ locationId: string; stockVersion: number }>;
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [confirmation, setConfirmation] = useState('');
  const confirmed = confirmation.trim() === documentNumber;

  return (
    <form action={formAction} className="space-y-3 rounded-[var(--radius)] border border-warning/30 bg-warning-soft/40 p-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedDocumentVersion" value={expectedDocumentVersion} />
      <input type="hidden" name="expectedLocationVersions" value={JSON.stringify(expectedLocationVersions)} />
      <div>
        <h2 className="text-sm font-semibold">{labels.title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{labels.hint}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.date}
          <input name="occurredAt" type="date" required defaultValue={occurredAt} className={input} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.confirmation}
          <input
            name="confirmationDocumentNumber"
            required
            autoComplete="off"
            value={confirmation}
            placeholder={documentNumber}
            className={input}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      </div>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.reason}
        <textarea name="reason" rows={3} minLength={3} maxLength={500} required className={input} />
      </label>
      {state?.error ? (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
          <p className="font-semibold">{errors[state.error] ?? state.error}</p>
          {state.debugId ? <p className="mt-1 text-xs">{state.debugId}</p> : null}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending || !confirmed}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-background disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
        {labels.submit}
      </button>
    </form>
  );
}
