'use client';

import { useActionState, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActionState } from '@/server/records/shared';

const input = 'min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

function ActionError({ state, errors }: { state: ActionState; errors: Record<string, string> }) {
  if (!state?.error) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
      <p className="font-semibold">{errors[state.error] ?? state.error}</p>
      {state.debugId ? <p className="mt-1 text-xs">{state.debugId}</p> : null}
    </div>
  );
}

export function OrderReturnToQuarantineForm({
  action,
  locale,
  idempotencyKey,
  occurredAt,
  expectedFulfillmentVersion,
  expectedQuarantineVersion,
  lines,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  idempotencyKey: string;
  occurredAt: string;
  expectedFulfillmentVersion: number;
  expectedQuarantineVersion: number;
  lines: Array<{ orderLineId: string; label: string; returnableQuantity: number }>;
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [orderLineId, setOrderLineId] = useState(lines[0]?.orderLineId ?? '');
  const selected = lines.find((line) => line.orderLineId === orderLineId);

  return (
    <form action={formAction} className="space-y-3 rounded-[var(--radius)] border bg-card p-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedFulfillmentVersion" value={expectedFulfillmentVersion} />
      <input type="hidden" name="expectedQuarantineVersion" value={expectedQuarantineVersion} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.item}
          <select name="orderLineId" value={orderLineId} required className={input} onChange={(event) => setOrderLineId(event.target.value)}>
            {lines.map((line) => <option key={line.orderLineId} value={line.orderLineId}>{line.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.quantity}
          <input name="quantity" type="number" min="0.001" max={selected?.returnableQuantity} step="0.001" required className={input} />
          {selected ? <span>{labels.returnable}: {selected.returnableQuantity}</span> : null}
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.date}
          <input name="occurredAt" type="date" defaultValue={occurredAt} required className={input} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.reason}
          <input name="reason" minLength={3} required className={input} />
        </label>
      </div>
      <ActionError state={state} errors={errors} />
      <button type="submit" disabled={pending || !selected} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.submit}
      </button>
    </form>
  );
}

type Disposition = 'RESTOCK' | 'REPACK' | 'RETURN_TO_SUPPLIER' | 'WASTE';

export function ReturnedGoodsDispositionForm({
  action,
  locale,
  idempotencyKey,
  occurredAt,
  returnDocumentId,
  expectedQuarantineVersion,
  expectedReturnDocumentVersion,
  items,
  locations,
  suppliers,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  idempotencyKey: string;
  occurredAt: string;
  returnDocumentId: string;
  expectedQuarantineVersion: number;
  expectedReturnDocumentVersion: number;
  items: Array<{ inventoryItemId: string; label: string; unit: string; quantity: number }>;
  locations: Array<{
    id: string;
    label: string;
    type: string;
    stockVersion: number;
    policies: Array<{ inventoryItemId: string; canSell: boolean; canProduce: boolean }>;
  }>;
  suppliers: Array<{ id: string; label: string }>;
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [inventoryItemId, setInventoryItemId] = useState(items[0]?.inventoryItemId ?? '');
  const [disposition, setDisposition] = useState<Disposition>('RESTOCK');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const item = items.find((row) => row.inventoryItemId === inventoryItemId);
  const destinations = useMemo(() => locations.filter((location) => {
    const policy = location.policies.find((row) => row.inventoryItemId === inventoryItemId);
    if (disposition === 'RESTOCK') return Boolean(policy?.canSell);
    if (disposition === 'REPACK') return location.type === 'PACKING' && Boolean(policy?.canProduce);
    return false;
  }), [disposition, inventoryItemId, locations]);
  const destination = destinations.find((location) => location.id === destinationLocationId);
  const needsDestination = disposition === 'RESTOCK' || disposition === 'REPACK';
  const onDispositionChange = (next: Disposition) => {
    setDisposition(next);
    setDestinationLocationId('');
  };

  return (
    <form action={formAction} className="space-y-3 rounded-[var(--radius)] border border-warning/25 bg-warning-soft/30 p-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="returnDocumentId" value={returnDocumentId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedQuarantineVersion" value={expectedQuarantineVersion} />
      <input type="hidden" name="expectedReturnDocumentVersion" value={expectedReturnDocumentVersion} />
      <input type="hidden" name="expectedDestinationVersion" value={destination?.stockVersion ?? ''} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.item}
          <select name="inventoryItemId" value={inventoryItemId} required className={input} onChange={(event) => {
            setInventoryItemId(event.target.value);
            setDestinationLocationId('');
          }}>
            {items.map((row) => <option key={row.inventoryItemId} value={row.inventoryItemId}>{row.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.quantity}
          <input name="quantity" type="number" min="0.001" max={item?.quantity} step="0.001" required className={input} />
          {item ? <span>{labels.outstanding}: {item.quantity} {item.unit}</span> : null}
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.disposition}
          <select name="disposition" value={disposition} required className={input} onChange={(event) => onDispositionChange(event.target.value as Disposition)}>
            <option value="RESTOCK">{labels.restock}</option>
            <option value="REPACK">{labels.repack}</option>
            <option value="RETURN_TO_SUPPLIER">{labels.returnToSupplier}</option>
            <option value="WASTE">{labels.waste}</option>
          </select>
        </label>
        {needsDestination ? (
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
            {labels.destination}
            <select name="destinationLocationId" value={destinationLocationId} required className={input} onChange={(event) => setDestinationLocationId(event.target.value)}>
              <option value="">—</option>
              {destinations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
            </select>
          </label>
        ) : null}
        {disposition === 'RETURN_TO_SUPPLIER' ? (
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
            {labels.supplier}
            <select name="supplierPartyId" required className={input}>
              <option value="">—</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.label}</option>)}
            </select>
          </label>
        ) : null}
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.date}
          <input name="occurredAt" type="date" defaultValue={occurredAt} required className={input} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground sm:col-span-2">
          {labels.reason}
          <input name="reason" minLength={3} required className={input} />
        </label>
      </div>
      {needsDestination && !destinations.length ? (
        <p className="rounded-lg border border-warning/20 bg-warning-soft p-3 text-sm text-warning">{labels.noDestination}</p>
      ) : null}
      <ActionError state={state} errors={errors} />
      <button type="submit" disabled={pending || !item || (needsDestination && !destination)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.submit}
      </button>
    </form>
  );
}
