'use client';

import { useActionState, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActionState } from '@/server/records/shared';

const input = 'min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

type PackingOutput = {
  inventoryItemId: string;
  productId: string;
  recipeVersionId: string;
  label: string;
  unit: string;
  producible: number;
  recipeVersion: number;
};

type PackingLocation = {
  id: string;
  label: string;
  stockVersion: number;
  outputs: PackingOutput[];
};

export function PackingRunForm({
  action,
  locale,
  idempotencyKey,
  packedAt,
  locations,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  idempotencyKey: string;
  packedAt: string;
  locations: PackingLocation[];
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const firstLocation = locations.find((location) => location.outputs.length) ?? locations[0];
  const [locationId, setLocationId] = useState(firstLocation?.id ?? '');
  const currentLocation = locations.find((location) => location.id === locationId);
  const outputs = useMemo(() => currentLocation?.outputs ?? [], [currentLocation]);
  const [selectedByLocation, setSelectedByLocation] = useState<Record<string, string>>(() => Object.fromEntries(
    locations.map((location) => [location.id, location.outputs[0]?.inventoryItemId ?? '']),
  ));
  const outputId = selectedByLocation[locationId] ?? '';
  const output = outputs.find((row) => row.inventoryItemId === outputId);

  return (
    <form action={formAction} className="grid gap-4 rounded-[var(--radius)] border bg-card p-4 sm:grid-cols-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedLocationVersion" value={currentLocation?.stockVersion ?? ''} />
      <input type="hidden" name="productId" value={output?.productId ?? ''} />
      <input type="hidden" name="recipeVersionId" value={output?.recipeVersionId ?? ''} />
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.location}
        <select name="locationId" value={locationId} required className={input} onChange={(event) => setLocationId(event.target.value)}>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.outputItem}
        <select
          name="outputInventoryItemId"
          value={outputId}
          required
          className={input}
          onChange={(event) => setSelectedByLocation((current) => ({ ...current, [locationId]: event.target.value }))}
        >
          <option value="" disabled>—</option>
          {outputs.map((row) => <option key={row.inventoryItemId} value={row.inventoryItemId}>{row.label}</option>)}
        </select>
        {output ? <span className="font-normal">{labels.recipeVersion} {output.recipeVersion} · {labels.producible} {output.producible} {output.unit}</span> : null}
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.outputQuantity}
        <input name="outputQuantity" type="number" min="0.001" step="0.001" required className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.rejectedQuantity}
        <input name="rejectedQuantity" type="number" min="0" step="0.001" defaultValue="0" required className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.packedAt}
        <input name="packedAt" type="date" defaultValue={packedAt} required className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.bestBefore}
        <input name="bestBefore" type="date" className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground sm:col-span-2">
        {labels.notes}
        <textarea name="notes" rows={3} className={input} />
      </label>
      {state?.error ? (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">
          <p className="font-semibold">{errors[state.error] ?? state.error}</p>
          {state.debugId ? <p className="mt-1 text-xs">{state.debugId}</p> : null}
        </div>
      ) : null}
      {!outputs.length ? <p className="text-sm text-warning sm:col-span-2">{labels.noOutputs}</p> : null}
      <button type="submit" disabled={pending || !currentLocation || !output} className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.submit}
      </button>
    </form>
  );
}
