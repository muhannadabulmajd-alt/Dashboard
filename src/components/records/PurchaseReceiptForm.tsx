'use client';

import { useActionState, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActionState } from '@/server/records/shared';

const input = 'min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

export function PurchaseReceiptForm({
  action,
  locale,
  idempotencyKey,
  receivedAt,
  locations,
  accounts,
  suppliers,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  idempotencyKey: string;
  receivedAt: string;
  locations: Array<{ id: string; label: string; stockVersion: number }>;
  accounts: Array<{ id: string; label: string }>;
  suppliers: Array<{ id: string; label: string }>;
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [paymentMode, setPaymentMode] = useState<'CREDIT' | 'PAID'>('CREDIT');
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
        {labels.quantity}
        <input name="quantity" type="number" min="0.001" step="0.001" required className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.unitCost}
        <input name="unitCost" type="number" min="0" step="0.001" required className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.receivedAt}
        <input name="occurredAt" type="date" defaultValue={receivedAt} required className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.bestBefore}
        <input name="bestBefore" type="date" className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.supplier}
        <select name="partyId" required className={input} defaultValue="">
          <option value="" disabled>—</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.supplierLot}
        <input name="supplierLot" className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.paymentMode}
        <select name="paymentMode" value={paymentMode} className={input} onChange={(event) => setPaymentMode(event.target.value as 'CREDIT' | 'PAID')}>
          <option value="CREDIT">{labels.credit}</option>
          <option value="PAID">{labels.paid}</option>
        </select>
      </label>
      {paymentMode === 'PAID' ? (
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.account}
          <select name="accountId" required className={input} defaultValue="">
            <option value="" disabled>—</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
          </select>
        </label>
      ) : (
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.dueDate}
          <input name="dueDate" type="date" defaultValue={receivedAt} className={input} />
        </label>
      )}
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.reference}
        <input name="reference" className={input} />
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
      <button type="submit" disabled={pending || !location || !suppliers.length || (paymentMode === 'PAID' && !accounts.length)} className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.submit}
      </button>
    </form>
  );
}
