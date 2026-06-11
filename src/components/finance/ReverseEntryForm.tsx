'use client';

import { useActionState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActionState } from '@/server/records/shared';

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function ReverseEntryForm({
  action,
  locale,
  labels,
}: {
  action: Action;
  locale: string;
  labels: {
    title: string;
    hint: string;
    reason: string;
    placeholder: string;
    submit: string;
    error: string;
  };
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);

  return (
    <form action={formAction} className="rounded-[var(--radius)] border border-warning/30 bg-warning-soft/40 p-4">
      <input type="hidden" name="locale" value={locale} />
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">{labels.title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{labels.hint}</p>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{labels.reason}</span>
        <textarea
          name="reason"
          required
          minLength={3}
          rows={3}
          placeholder={labels.placeholder}
          className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>
      {state?.error ? <p className="mt-2 text-sm font-medium text-danger">{labels.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-background hover:opacity-95 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.submit}
      </button>
    </form>
  );
}
