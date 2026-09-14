'use client';

import { useActionState, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActionState } from '@/server/records/shared';

const input = 'min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

type RoastLocation = {
  id: string;
  label: string;
  stockVersion: number;
  greenItems: Array<{ id: string; label: string; unit: string; available: number }>;
  roastedItems: Array<{ id: string; label: string; unit: string }>;
};

export function RoastProductionForm({
  action,
  locale,
  idempotencyKey,
  roastDate,
  locations,
  roastLevels,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  idempotencyKey: string;
  roastDate: string;
  locations: RoastLocation[];
  roastLevels: Array<{ value: string; label: string }>;
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const first = locations.find((location) => location.greenItems.length && location.roastedItems.length) ?? locations[0];
  const [locationId, setLocationId] = useState(first?.id ?? '');
  const location = locations.find((row) => row.id === locationId);

  return (
    <form action={formAction} className="grid gap-4 rounded-[var(--radius)] border bg-card p-4 sm:grid-cols-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedLocationVersion" value={location?.stockVersion ?? ''} />
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground sm:col-span-2">
        {labels.location}
        <select name="locationId" value={locationId} required className={input} onChange={(event) => setLocationId(event.target.value)}>
          {locations.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.batchNumber}
        <input name="batchNumber" required className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.origin}
        <input name="origin" required className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.greenItem}
        <select name="greenInventoryItemId" required defaultValue="" className={input} key={`green-${locationId}`}>
          <option value="" disabled>—</option>
          {(location?.greenItems ?? []).map((item) => (
            <option key={item.id} value={item.id}>{item.label} · {labels.available} {item.available} {item.unit}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.roastedItem}
        <select name="roastedInventoryItemId" required defaultValue="" className={input} key={`roasted-${locationId}`}>
          <option value="" disabled>—</option>
          {(location?.roastedItems ?? []).map((item) => <option key={item.id} value={item.id}>{item.label} ({item.unit})</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.greenInput}
        <input name="greenInputGrams" type="number" min="1" step="1" required className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.roastedOutput}
        <input name="roastedOutputGrams" type="number" min="1" step="1" required className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.abnormalLoss}
        <input name="abnormalLossGrams" type="number" min="0" step="1" defaultValue="0" required className={input} />
        <span className="font-normal leading-5">{labels.abnormalLossHint}</span>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.roastDate}
        <input name="roastDate" type="date" defaultValue={roastDate} required className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.roastLevel}
        <select name="roastLevel" className={input} defaultValue="">
          <option value="">—</option>
          {roastLevels.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.qcScore}
        <input name="qcScore" type="number" min="0" max="100" step="0.1" className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground sm:col-span-2">
        {labels.qcNotes}
        <textarea name="qcNotes" rows={3} className={input} />
      </label>
      {state?.error ? (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">
          <p className="font-semibold">{errors[state.error] ?? state.error}</p>
          {state.debugId ? <p className="mt-1 text-xs">{state.debugId}</p> : null}
        </div>
      ) : null}
      {!location?.greenItems.length || !location.roastedItems.length ? (
        <p className="text-sm text-warning sm:col-span-2">{labels.noItems}</p>
      ) : null}
      <button type="submit" disabled={pending || !location?.greenItems.length || !location.roastedItems.length} className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.submit}
      </button>
    </form>
  );
}
