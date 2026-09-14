'use client';

import { useActionState, useMemo, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import type { ActionState } from '@/server/records/shared';

const input = 'min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

export type TransferItemOption = {
  id: string;
  label: string;
  unit: string;
  available: number;
};

export type TransferLocationOption = {
  id: string;
  label: string;
  stockVersion: number;
  transitVersion: number | null;
  itemIds: string[];
  items: TransferItemOption[];
};

type TransferLine = { inventoryItemId: string; quantity: string };
type ReceiptLine = TransferLine & {
  label: string;
  unit: string;
  outstanding: number;
  discrepancyType: '' | 'SHORTAGE' | 'DAMAGE' | 'EXCESS';
  discrepancyQuantity: string;
  discrepancyNotes: string;
};

function ActionError({ state, errors }: { state: ActionState; errors: Record<string, string> }) {
  if (!state?.error) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
      <p className="font-semibold">{errors[state.error] ?? state.error}</p>
      {state.debugId ? <p className="mt-1 text-xs">{state.debugId}</p> : null}
    </div>
  );
}

export function StockTransferDispatchForm({
  action,
  locale,
  idempotencyKey,
  occurredAt,
  sourceLocations,
  destinationLocations,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  idempotencyKey: string;
  occurredAt: string;
  sourceLocations: TransferLocationOption[];
  destinationLocations: TransferLocationOption[];
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [sourceId, setSourceId] = useState(sourceLocations[0]?.id ?? '');
  const [destinationId, setDestinationId] = useState(
    destinationLocations.find((location) => location.id !== sourceLocations[0]?.id)?.id ?? '',
  );
  const [lines, setLines] = useState<TransferLine[]>([{ inventoryItemId: '', quantity: '1' }]);
  const source = sourceLocations.find((location) => location.id === sourceId);
  const destination = destinationLocations.find((location) => location.id === destinationId);
  const items = useMemo(() => {
    if (!source || !destination) return [];
    const configured = new Set(destination.itemIds);
    return source.items.filter((item) => configured.has(item.id));
  }, [source, destination]);

  const setLine = (index: number, field: keyof TransferLine, value: string) => {
    setLines((current) => current.map((line, row) => row === index ? { ...line, [field]: value } : line));
  };
  const serializedLines = lines
    .filter((line) => line.inventoryItemId && Number(line.quantity) > 0)
    .map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: line.quantity }));

  return (
    <form action={formAction} className="space-y-4 rounded-[var(--radius)] border bg-card p-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="lines" value={JSON.stringify(serializedLines)} />
      <input type="hidden" name="expectedSourceVersion" value={source?.stockVersion ?? ''} />
      <input type="hidden" name="expectedTransitVersion" value={destination?.transitVersion ?? ''} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.source}
          <select
            name="sourceLocationId"
            value={sourceId}
            required
            className={input}
            onChange={(event) => {
              setSourceId(event.target.value);
              setLines([{ inventoryItemId: '', quantity: '1' }]);
              if (destinationId === event.target.value) {
                setDestinationId(destinationLocations.find((location) => location.id !== event.target.value)?.id ?? '');
              }
            }}
          >
            {sourceLocations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.destination}
          <select
            name="destinationLocationId"
            value={destinationId}
            required
            className={input}
            onChange={(event) => {
              setDestinationId(event.target.value);
              setLines([{ inventoryItemId: '', quantity: '1' }]);
            }}
          >
            <option value="">—</option>
            {destinationLocations.filter((location) => location.id !== sourceId && location.transitVersion != null).map((location) => (
              <option key={location.id} value={location.id}>{location.label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.date}
          <input name="occurredAt" type="date" required defaultValue={occurredAt} className={input} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.expectedDate}
          <input name="expectedAt" type="date" className={input} />
        </label>
      </div>

      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{labels.items}</h3>
          <button
            type="button"
            onClick={() => setLines((current) => [...current, { inventoryItemId: '', quantity: '1' }])}
            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
          >
            <Plus className="size-3.5" /> {labels.addLine}
          </button>
        </div>
        {lines.map((line, index) => {
          const selected = items.find((item) => item.id === line.inventoryItemId);
          return (
            <div key={index} className="grid gap-2 rounded-lg border bg-background/50 p-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
              <label className="grid gap-1 text-xs text-muted-foreground">
                {labels.item}
                <select value={line.inventoryItemId} required className={input} onChange={(event) => setLine(index, 'inventoryItemId', event.target.value)}>
                  <option value="">—</option>
                  {items.map((item) => <option key={item.id} value={item.id}>{item.label} · {labels.available} {item.available} {item.unit}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                {labels.quantity}{selected ? ` (${selected.unit})` : ''}
                <input type="number" min="0.001" step="0.001" value={line.quantity} required className={input} onChange={(event) => setLine(index, 'quantity', event.target.value)} />
              </label>
              <button
                type="button"
                aria-label={labels.removeLine}
                onClick={() => setLines((current) => current.length > 1 ? current.filter((_, row) => row !== index) : current)}
                className="self-end rounded-lg border p-2.5 text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
        {!items.length && source && destination ? (
          <p className="rounded-lg border border-warning/20 bg-warning-soft p-3 text-sm text-warning">{labels.noSharedItems}</p>
        ) : null}
      </div>

      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.notes}
        <textarea name="notes" rows={3} className={input} />
      </label>
      <ActionError state={state} errors={errors} />
      <button
        type="submit"
        disabled={pending || !source || !destination || !serializedLines.length || destination.transitVersion == null}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.dispatch}
      </button>
    </form>
  );
}

export function StockTransferReceiptForm({
  action,
  locale,
  idempotencyKey,
  occurredAt,
  destinationLocationId,
  expectedDestinationVersion,
  expectedTransitVersion,
  expectedDocumentVersion,
  initialLines,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  idempotencyKey: string;
  occurredAt: string;
  destinationLocationId: string;
  expectedDestinationVersion: number;
  expectedTransitVersion: number;
  expectedDocumentVersion: number;
  initialLines: Array<{ inventoryItemId: string; label: string; unit: string; outstanding: number }>;
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [lines, setLines] = useState<ReceiptLine[]>(() => initialLines.map((line) => ({
    ...line,
    quantity: line.outstanding.toFixed(3),
    discrepancyType: '',
    discrepancyQuantity: '',
    discrepancyNotes: '',
  })));
  const setLine = <K extends keyof ReceiptLine>(index: number, field: K, value: ReceiptLine[K]) => {
    setLines((current) => current.map((line, row) => row === index ? { ...line, [field]: value } : line));
  };
  const receiptLines = lines
    .filter((line) => Number(line.quantity) > 0)
    .map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: line.quantity }));
  const discrepancies = lines
    .filter((line) => line.discrepancyType && Number(line.discrepancyQuantity) > 0 && line.discrepancyNotes.trim())
    .map((line) => ({
      inventoryItemId: line.inventoryItemId,
      type: line.discrepancyType,
      quantity: line.discrepancyQuantity,
      notes: line.discrepancyNotes.trim(),
    }));

  return (
    <form action={formAction} className="space-y-4 rounded-[var(--radius)] border bg-card p-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="destinationLocationId" value={destinationLocationId} />
      <input type="hidden" name="expectedDestinationVersion" value={expectedDestinationVersion} />
      <input type="hidden" name="expectedTransitVersion" value={expectedTransitVersion} />
      <input type="hidden" name="expectedDocumentVersion" value={expectedDocumentVersion} />
      <input type="hidden" name="lines" value={JSON.stringify(receiptLines)} />
      <input type="hidden" name="discrepancies" value={JSON.stringify(discrepancies)} />
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground sm:max-w-xs">
        {labels.receivedAt}
        <input name="occurredAt" type="date" required defaultValue={occurredAt} className={input} />
      </label>
      <div className="space-y-3">
        {lines.map((line, index) => (
          <div key={line.inventoryItemId} className="grid gap-3 rounded-lg border bg-background/50 p-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-end">
              <div>
                <p className="text-sm font-semibold">{line.label}</p>
                <p className="text-xs text-muted-foreground">{labels.outstanding}: {line.outstanding} {line.unit}</p>
              </div>
              <label className="grid gap-1 text-xs text-muted-foreground">
                {labels.receivedQuantity}
                <input type="number" min="0" max={line.outstanding} step="0.001" value={line.quantity} className={input} onChange={(event) => setLine(index, 'quantity', event.target.value)} />
              </label>
            </div>
            <div className="grid gap-2 border-t pt-3 sm:grid-cols-[10rem_10rem_minmax(0,1fr)]">
              <label className="grid gap-1 text-xs text-muted-foreground">
                {labels.discrepancy}
                <select value={line.discrepancyType} className={input} onChange={(event) => setLine(index, 'discrepancyType', event.target.value as ReceiptLine['discrepancyType'])}>
                  <option value="">—</option>
                  <option value="SHORTAGE">{labels.shortage}</option>
                  <option value="DAMAGE">{labels.damage}</option>
                  <option value="EXCESS">{labels.excess}</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                {labels.discrepancyQuantity}
                <input type="number" min="0.001" step="0.001" disabled={!line.discrepancyType} value={line.discrepancyQuantity} className={input} onChange={(event) => setLine(index, 'discrepancyQuantity', event.target.value)} />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                {labels.discrepancyNotes}
                <input disabled={!line.discrepancyType} value={line.discrepancyNotes} className={input} onChange={(event) => setLine(index, 'discrepancyNotes', event.target.value)} />
              </label>
            </div>
          </div>
        ))}
      </div>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.notes}
        <textarea name="notes" rows={3} className={input} />
      </label>
      <ActionError state={state} errors={errors} />
      <button type="submit" disabled={pending || (!receiptLines.length && !discrepancies.length)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.receive}
      </button>
    </form>
  );
}
