'use client';

import { useActionState, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { resetBusinessData } from './actions';
import type { ActionState } from '@/server/records/shared';

export function ResetDataPanel({ labels }: { labels: Record<string, string> }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(resetBusinessData, undefined);
  const [confirm, setConfirm] = useState('');

  return (
    <section className="space-y-3 rounded-[var(--radius)] border border-danger/40 bg-danger-soft/40 p-4">
      <div className="flex items-center gap-2 text-danger">
        <AlertTriangle className="size-5" />
        <h3 className="text-sm font-bold">{labels.title}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{labels.body}</p>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input
          name="confirm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={labels.placeholder}
          className="w-48 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-danger"
        />
        <button
          type="submit"
          disabled={pending || confirm !== 'RESET'}
          className="inline-flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
          {labels.button}
        </button>
        {state?.ok ? <span className="text-sm font-medium text-success">{labels.done}</span> : null}
        {state?.error === 'confirm' ? <span className="text-sm font-medium text-danger">{labels.mismatch}</span> : null}
        {state?.error === 'forbidden' ? <span className="text-sm font-medium text-danger">{labels.forbidden}</span> : null}
      </form>
    </section>
  );
}
