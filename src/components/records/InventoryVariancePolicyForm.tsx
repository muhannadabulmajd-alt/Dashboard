'use client';

import { useActionState, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActionState } from '@/server/records/shared';

const inputClass = 'min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

export function InventoryVariancePolicyForm({
  action,
  locale,
  expectedLocationVersion,
  initial,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  expectedLocationVersion: number;
  initial: {
    isActive: boolean;
    openingBalanceAccountCode: string;
    inventoryGainAccountCode: string;
    inventoryLossAccountCode: string;
  };
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [isActive, setIsActive] = useState(initial.isActive);

  return (
    <form action={formAction} className="mt-5 space-y-4 rounded-lg border bg-card p-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="expectedLocationVersion" value={expectedLocationVersion} />
      <div>
        <h2 className="text-sm font-bold">{labels.title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{labels.hint}</p>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          name="isActive"
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          className="size-4 accent-primary"
        />
        {labels.active}
      </label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.opening}
          <input
            name="openingBalanceAccountCode"
            defaultValue={initial.openingBalanceAccountCode}
            required={isActive}
            maxLength={80}
            pattern="[A-Za-z0-9._/-]+"
            className={inputClass}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.gain}
          <input
            name="inventoryGainAccountCode"
            defaultValue={initial.inventoryGainAccountCode}
            required={isActive}
            maxLength={80}
            pattern="[A-Za-z0-9._/-]+"
            className={inputClass}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.loss}
          <input
            name="inventoryLossAccountCode"
            defaultValue={initial.inventoryLossAccountCode}
            required={isActive}
            maxLength={80}
            pattern="[A-Za-z0-9._/-]+"
            className={inputClass}
          />
        </label>
      </div>
      {state?.error ? (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          {errors[state.error] ?? state.error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.save}
      </button>
    </form>
  );
}
