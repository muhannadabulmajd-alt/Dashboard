'use client';

import { useActionState, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActionState } from '@/server/records/shared';

const input = 'min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

export function StockDiscrepancyResolutionForm({
  action,
  locale,
  idempotencyKey,
  occurredAt,
  expectedDiscrepancyVersion,
  expectedLocationVersion,
  type,
  defaultUnitCost,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  idempotencyKey: string;
  occurredAt: string;
  expectedDiscrepancyVersion: number;
  expectedLocationVersion: number;
  type: 'SHORTAGE' | 'DAMAGE' | 'EXCESS';
  defaultUnitCost?: number | null;
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const needsUnitCost = decision === 'APPROVE' && type === 'EXCESS';

  return (
    <form action={formAction} className="grid gap-3 rounded-lg border bg-background/50 p-3 sm:grid-cols-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedDiscrepancyVersion" value={expectedDiscrepancyVersion} />
      <input type="hidden" name="expectedLocationVersion" value={expectedLocationVersion} />
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.decision}
        <select
          name="decision"
          value={decision}
          className={input}
          onChange={(event) => setDecision(event.target.value as 'APPROVE' | 'REJECT')}
        >
          <option value="APPROVE">{labels.approve}</option>
          <option value="REJECT">{labels.reject}</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.date}
        <input name="occurredAt" type="date" required defaultValue={occurredAt} className={input} />
      </label>
      {needsUnitCost ? (
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground sm:col-span-2">
          {labels.unitCost}
          <input
            name="approvedUnitCost"
            type="number"
            min="0.001"
            step="0.001"
            required
            defaultValue={defaultUnitCost && defaultUnitCost > 0 ? defaultUnitCost : undefined}
            className={input}
          />
        </label>
      ) : null}
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground sm:col-span-2">
        {labels.resolution}
        <textarea name="resolution" rows={2} minLength={3} maxLength={500} required className={input} />
      </label>
      {state?.error ? (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">
          <p className="font-semibold">{errors[state.error] ?? state.error}</p>
          {state.debugId ? <p className="mt-1 text-xs">{state.debugId}</p> : null}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2 sm:justify-self-start"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {decision === 'APPROVE' ? labels.approve : labels.reject}
      </button>
    </form>
  );
}
