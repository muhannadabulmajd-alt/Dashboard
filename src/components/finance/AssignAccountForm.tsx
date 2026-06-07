'use client';

import { useActionState } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import type { ActionState } from '@/server/records/shared';

const input = 'rounded-lg border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary';

/** Inline control to set the paying account on imported purchases (by currency). */
export function AssignAccountForm({
  action,
  locale,
  accounts,
  labels,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  locale: string;
  accounts: { value: string; label: string }[];
  labels: { title: string; hint: string; apply: string };
}) {
  const [, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  if (accounts.length === 0) return null;
  return (
    <details className="rounded-[var(--radius)] border bg-card p-3 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
        <Wallet className="size-4 text-muted-foreground" />
        {labels.title}
      </summary>
      <p className="mt-1 text-xs text-muted-foreground">{labels.hint}</p>
      <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="locale" value={locale} />
        <select name="accountId" required className={input}>
          {accounts.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {labels.apply}
        </button>
      </form>
    </details>
  );
}
