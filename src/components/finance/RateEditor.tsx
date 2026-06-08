'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/server/records/shared';

export function RateEditor({
  action,
  locale,
  rate,
  label,
  apply,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  locale: string;
  rate: number;
  label: string;
  apply: string;
}) {
  const [, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border bg-card px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}:</span>
      <input type="hidden" name="locale" value={locale} />
      <span className="font-medium">1 USD =</span>
      <input
        name="rate"
        type="number"
        step="1"
        min="1"
        defaultValue={rate}
        className="w-24 rounded-lg border bg-background px-2 py-1 outline-none focus:border-primary"
      />
      <span className="font-medium">IQD</span>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-60"
      >
        {apply}
      </button>
    </form>
  );
}
