'use client';

import { useActionState, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import type { ActionState } from '@/server/records/shared';

const input = 'min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

export type CountLocationOption = {
  id: string;
  label: string;
  stockVersion: number;
  items: Array<{
    inventoryItemId: string;
    label: string;
    unit: string;
    expectedQuantity: number;
  }>;
};

type CountRow = CountLocationOption['items'][number] & {
  countedQuantity: string;
  notes: string;
};

function ErrorMessage({ state, errors }: { state: ActionState; errors: Record<string, string> }) {
  if (!state?.error) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
      <p className="font-semibold">{errors[state.error] ?? state.error}</p>
      {state.debugId ? <p className="mt-1 text-xs">{state.debugId}</p> : null}
    </div>
  );
}

export function InventoryCountForm({
  action,
  locale,
  idempotencyKey,
  countedAt,
  locations,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  idempotencyKey: string;
  countedAt: string;
  locations: CountLocationOption[];
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [kind, setKind] = useState<'ROUTINE' | 'OPENING'>('ROUTINE');
  const [openingAttestation, setOpeningAttestation] = useState(false);
  const selectedLocation = locations.find((location) => location.id === locationId);
  const [rowsByLocation, setRowsByLocation] = useState<Record<string, CountRow[]>>(() => Object.fromEntries(
    locations.map((location) => [
      location.id,
      location.items.map((item) => ({ ...item, countedQuantity: '', notes: '' })),
    ]),
  ));
  const rows = rowsByLocation[locationId] ?? [];
  const setRow = (index: number, field: 'countedQuantity' | 'notes', value: string) => {
    setRowsByLocation((current) => ({
      ...current,
      [locationId]: (current[locationId] ?? []).map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row),
    }));
  };
  const serializedLines = rows
    .filter((row) => row.countedQuantity.trim() !== '' && Number(row.countedQuantity) >= 0)
    .map((row) => ({
      inventoryItemId: row.inventoryItemId,
      countedQuantity: row.countedQuantity,
      notes: row.notes.trim() || undefined,
    }));
  const openingComplete = kind !== 'OPENING' || (
    rows.length > 0 &&
    serializedLines.length === rows.length &&
    openingAttestation
  );

  return (
    <form action={formAction} className="space-y-4 rounded-[var(--radius)] border bg-card p-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="openingAttestation" value={openingAttestation ? 'true' : 'false'} />
      <input type="hidden" name="expectedLocationVersion" value={selectedLocation?.stockVersion ?? ''} />
      <input type="hidden" name="lines" value={JSON.stringify(serializedLines)} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.location}
          <select name="locationId" value={locationId} required className={input} onChange={(event) => setLocationId(event.target.value)}>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.kind}
          <select
            value={kind}
            className={input}
            onChange={(event) => {
              setKind(event.target.value as 'ROUTINE' | 'OPENING');
              setOpeningAttestation(false);
            }}
          >
            <option value="ROUTINE">{labels.routineCount}</option>
            <option value="OPENING">{labels.openingCount}</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.countedAt}
          <input name="countedAt" type="date" defaultValue={countedAt} required className={input} />
        </label>
      </div>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.reason}
        <input name="reason" minLength={3} required className={input} />
      </label>
      <div className="space-y-2 border-t pt-4">
        <div className="grid grid-cols-[minmax(0,1fr)_8rem_9rem] gap-2 px-2 text-xs font-semibold text-muted-foreground">
          <span>{labels.item}</span>
          <span>{labels.expected}</span>
          <span>{labels.counted}</span>
        </div>
        {rows.map((row, index) => (
          <div key={row.inventoryItemId} className="grid gap-2 rounded-lg border bg-background/50 p-2 sm:grid-cols-[minmax(0,1fr)_8rem_9rem_minmax(8rem,0.7fr)] sm:items-center">
            <div>
              <p className="text-sm font-semibold">{row.label}</p>
              <p className="text-xs text-muted-foreground">{row.unit}</p>
            </div>
            <p className="text-sm tabular-nums">{row.expectedQuantity}</p>
            <label className="grid gap-1 text-xs text-muted-foreground sm:block">
              <span className="sm:sr-only">{labels.counted}</span>
              <input type="number" min="0" step="0.001" value={row.countedQuantity} placeholder="—" className={input} onChange={(event) => setRow(index, 'countedQuantity', event.target.value)} />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground sm:block">
              <span className="sm:sr-only">{labels.notes}</span>
              <input value={row.notes} placeholder={labels.notes} className={input} onChange={(event) => setRow(index, 'notes', event.target.value)} />
            </label>
          </div>
        ))}
        {!rows.length ? <p className="rounded-lg border border-warning/20 bg-warning-soft p-3 text-sm text-warning">{labels.noItems}</p> : null}
      </div>
      {kind === 'OPENING' ? (
        <div className="space-y-2 rounded-lg border border-warning/25 bg-warning-soft/40 p-3">
          <p className="text-sm leading-6 text-foreground">{labels.openingHint}</p>
          <label className="flex items-start gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={openingAttestation}
              className="mt-1 size-4"
              onChange={(event) => setOpeningAttestation(event.target.checked)}
            />
            <span>{labels.openingAttestation}</span>
          </label>
          {!openingComplete ? <p className="text-xs text-warning">{labels.openingIncomplete}</p> : null}
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">{labels.blankHint}</p>
      )}
      <ErrorMessage state={state} errors={errors} />
      <button type="submit" disabled={pending || !serializedLines.length || !openingComplete} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.submit}
      </button>
    </form>
  );
}

export function InventoryCountApprovalForm({
  action,
  locale,
  idempotencyKey,
  occurredAt,
  expectedLocationVersion,
  expectedCountVersion,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  idempotencyKey: string;
  occurredAt: string;
  expectedLocationVersion: number;
  expectedCountVersion: number;
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  return (
    <form action={formAction} className="grid gap-3 rounded-[var(--radius)] border border-warning/25 bg-warning-soft/40 p-4 sm:grid-cols-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedLocationVersion" value={expectedLocationVersion} />
      <input type="hidden" name="expectedCountVersion" value={expectedCountVersion} />
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.date}
        <input name="occurredAt" type="date" defaultValue={occurredAt} required className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.reason}
        <input name="reason" minLength={3} required className={input} />
      </label>
      <div className="sm:col-span-2"><ErrorMessage state={state} errors={errors} /></div>
      <button type="submit" disabled={pending} className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.approve}
      </button>
    </form>
  );
}

export function InventoryCountRejectionForm({
  action,
  locale,
  idempotencyKey,
  expectedCountVersion,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  idempotencyKey: string;
  expectedCountVersion: number;
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  return (
    <form action={formAction} className="mt-3 grid gap-3 rounded-[var(--radius)] border border-danger/20 bg-danger-soft/30 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedCountVersion" value={expectedCountVersion} />
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.reason}
        <input name="reason" minLength={3} required className={input} />
      </label>
      <button type="submit" disabled={pending} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-danger/30 bg-background px-4 py-2 text-sm font-semibold text-danger disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
        {labels.reject}
      </button>
      <div className="sm:col-span-2"><ErrorMessage state={state} errors={errors} /></div>
    </form>
  );
}
