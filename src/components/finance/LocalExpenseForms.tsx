'use client';

import { useActionState, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActionState } from '@/server/records/shared';
import { LOCAL_EXPENSE_RECEIPT_MAX_BYTES } from '@/server/inventory-v2/local-expense-policy';

const input = 'min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

function ErrorMessage({ state, errors }: { state: ActionState; errors: Record<string, string> }) {
  if (!state?.error) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
      <p className="font-semibold">{errors[state.error] ?? state.error}</p>
      {state.debugId ? <p className="mt-1 text-xs">{state.debugId}</p> : null}
    </div>
  );
}

export function LocalExpenseForm({
  action,
  locale,
  idempotencyKey,
  occurredAt,
  locations,
  categories,
  accountLabel,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  idempotencyKey: string;
  occurredAt: string;
  locations: Array<{ id: string; label: string; stockVersion: number; accountEligible: boolean }>;
  categories: Array<{ value: string; label: string }>;
  accountLabel: string | null;
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [evidenceMode, setEvidenceMode] = useState<'RECEIPT' | 'REASON'>('RECEIPT');
  const [fileError, setFileError] = useState('');
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
        {labels.amount}
        <input name="amount" type="number" min="1" step="1" required className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.date}
        <input name="occurredAt" type="date" defaultValue={occurredAt} required className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground sm:col-span-2">
        {labels.category}
        <select name="categoryType" required defaultValue="" className={input}>
          <option value="" disabled>—</option>
          {categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground sm:col-span-2">
        {labels.description}
        <textarea name="description" rows={3} minLength={3} maxLength={500} required className={input} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground sm:col-span-2">
        {labels.evidence}
        <select value={evidenceMode} className={input} onChange={(event) => {
          setEvidenceMode(event.target.value as 'RECEIPT' | 'REASON');
          setFileError('');
        }}>
          <option value="RECEIPT">{labels.receipt}</option>
          <option value="REASON">{labels.noReceipt}</option>
        </select>
      </label>
      {evidenceMode === 'RECEIPT' ? (
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground sm:col-span-2">
          {labels.receipt}
          <input
            name="receipt"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            required
            className={input}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              setFileError(file && file.size > LOCAL_EXPENSE_RECEIPT_MAX_BYTES ? labels.fileTooLarge : '');
            }}
          />
          <span className="font-normal">{labels.receiptHint}</span>
        </label>
      ) : (
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground sm:col-span-2">
          {labels.noReceiptReason}
          <textarea name="noReceiptReason" rows={2} minLength={3} maxLength={500} required className={input} />
        </label>
      )}
      <div className="rounded-lg border bg-muted/30 p-3 text-sm sm:col-span-2">
        <p className="text-xs font-semibold text-muted-foreground">{labels.account}</p>
        <p className="mt-1 font-semibold">{accountLabel ?? labels.accountMissing}</p>
        {location && !location.accountEligible ? <p className="mt-1 text-xs text-warning">{labels.accountLocationMismatch}</p> : null}
      </div>
      {fileError ? <p role="alert" className="text-sm font-semibold text-danger sm:col-span-2">{fileError}</p> : null}
      <div className="sm:col-span-2"><ErrorMessage state={state} errors={errors} /></div>
      <button
        type="submit"
        disabled={pending || !location?.accountEligible || Boolean(fileError)}
        className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.submit}
      </button>
    </form>
  );
}

export function LocalExpenseReviewForm({
  action,
  locale,
  idempotencyKey,
  occurredAt,
  expectedRequestVersion,
  expectedLocationVersion,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  idempotencyKey: string;
  occurredAt: string;
  expectedRequestVersion: number;
  expectedLocationVersion: number;
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  return (
    <form action={formAction} className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="occurredAt" value={occurredAt} />
      <input type="hidden" name="expectedRequestVersion" value={expectedRequestVersion} />
      <input type="hidden" name="expectedLocationVersion" value={expectedLocationVersion} />
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        {labels.reviewReason}
        <input name="reason" minLength={3} maxLength={500} required className={input} />
      </label>
      <button name="decision" value="APPROVE" type="submit" disabled={pending} className="min-h-10 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {labels.approve}
      </button>
      <button name="decision" value="REJECT" type="submit" disabled={pending} className="min-h-10 rounded-lg border border-danger/30 px-4 py-2 text-sm font-semibold text-danger disabled:opacity-60">
        {labels.reject}
      </button>
      <div className="sm:col-span-3"><ErrorMessage state={state} errors={errors} /></div>
    </form>
  );
}

export function LocationExpensePolicyForm({
  action,
  locale,
  expectedLocationVersion,
  categories,
  initial,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  expectedLocationVersion: number;
  categories: Array<{ value: string; label: string }>;
  initial: { isActive: boolean; allowedCategories: string[]; maxImmediateAmount: number; receiptRequiredAbove: number };
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  return (
    <form action={formAction} className="mt-5 space-y-4 rounded-[var(--radius)] border bg-card p-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="expectedLocationVersion" value={expectedLocationVersion} />
      <div>
        <h2 className="text-sm font-bold">{labels.policyTitle}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{labels.policyHint}</p>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input name="isActive" type="checkbox" defaultChecked={initial.isActive} className="size-4 accent-primary" />
        {labels.policyActive}
      </label>
      <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-xs font-semibold text-muted-foreground">{labels.allowedCategories}</legend>
        {categories.map((category) => (
          <label key={category.value} className="flex items-center gap-2 rounded-lg border bg-background p-2 text-sm">
            <input name="allowedCategories" value={category.value} type="checkbox" defaultChecked={initial.allowedCategories.includes(category.value)} className="size-4 accent-primary" />
            {category.label}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.maxImmediateAmount}
          <input name="maxImmediateAmount" type="number" min="0" step="1" defaultValue={initial.maxImmediateAmount} required className={input} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          {labels.receiptRequiredAbove}
          <input name="receiptRequiredAbove" type="number" min="0" step="1" defaultValue={initial.receiptRequiredAbove} required className={input} />
        </label>
      </div>
      <ErrorMessage state={state} errors={errors} />
      <button type="submit" disabled={pending} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.savePolicy}
      </button>
    </form>
  );
}
