'use client';

import { useActionState, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActionState } from '@/server/records/shared';

const input = 'min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

type LocationOption = {
  id: string;
  label: string;
  stockVersion: number;
  policy: {
    reorderPoint: string;
    targetLevel: string;
    canSell: boolean;
    canProduce: boolean;
    isActive: boolean;
  } | null;
};

export function InventoryLocationPolicyForm({
  action,
  locale,
  locations,
  defaultCanSell,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  locations: LocationOption[];
  defaultCanSell: boolean;
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const selected = locations.find((location) => location.id === locationId) ?? null;
  const policy = selected?.policy;
  return (
    <form action={formAction} className="grid gap-4 rounded-[var(--radius)] border bg-card p-4 sm:grid-cols-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="expectedLocationVersion" value={selected?.stockVersion ?? ''} />
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground sm:col-span-2">
        {labels.location}
        <select name="locationId" value={locationId} required className={input} onChange={(event) => setLocationId(event.target.value)}>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
        </select>
      </label>
      <label key={`reorder-${locationId}`} className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.reorderPoint}
        <input name="reorderPoint" type="number" min="0" step="0.001" defaultValue={policy?.reorderPoint ?? ''} className={input} />
      </label>
      <label key={`target-${locationId}`} className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.targetLevel}
        <input name="targetLevel" type="number" min="0" step="0.001" defaultValue={policy?.targetLevel ?? ''} className={input} />
      </label>
      <label key={`sell-${locationId}`} className="flex items-start gap-2 rounded-lg border p-3 text-sm font-semibold">
        <input name="canSell" type="checkbox" defaultChecked={policy?.canSell ?? defaultCanSell} className="mt-1 size-4" />
        <span>{labels.canSell}</span>
      </label>
      <label key={`produce-${locationId}`} className="flex items-start gap-2 rounded-lg border p-3 text-sm font-semibold">
        <input name="canProduce" type="checkbox" defaultChecked={policy?.canProduce ?? false} className="mt-1 size-4" />
        <span>{labels.canProduce}</span>
      </label>
      <label key={`active-${locationId}`} className="flex items-start gap-2 rounded-lg border p-3 text-sm font-semibold sm:col-span-2">
        <input name="isActive" type="checkbox" defaultChecked={policy?.isActive ?? true} className="mt-1 size-4" />
        <span>{labels.isActive}</span>
      </label>
      {state?.error ? <p role="alert" className="text-sm font-semibold text-danger sm:col-span-2">{errors[state.error] ?? state.error}</p> : null}
      <button type="submit" disabled={pending || !selected} className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.save}
      </button>
    </form>
  );
}
