'use client';

import { useActionState, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { ActionState } from '@/server/records/shared';

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';
type Opt = { value: string; label: string };
type Line = { sku: string; quantity: string; unitGrossPrice: string; lineDiscount: string };
const emptyLine: Line = { sku: '', quantity: '1', unitGrossPrice: '0', lineDiscount: '0' };

export function OrderForm({
  action,
  locale,
  channelOptions,
  governorateOptions,
  fulfillmentOptions,
  statusOptions,
  labels,
  errors,
  cancelHref,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  locale: string;
  channelOptions: Opt[];
  governorateOptions: Opt[];
  fulfillmentOptions: Opt[];
  statusOptions: Opt[];
  labels: Record<string, string>;
  errors: Record<string, string>;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);

  const setLine = (i: number, k: keyof Line, v: string) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  const Field = ({ name, label, type = 'text' }: { name: string; label: string; type?: string }) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input name={name} type={type} className={input} />
    </div>
  );
  const Select = ({ name, label, options }: { name: string; label: string; options: Opt[] }) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <select name={name} className={input} defaultValue={options[0]?.value}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />

      <div className="grid gap-3 rounded-[var(--radius)] border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field name="orderNumber" label={labels.orderNumber} />
        <Field name="placedAt" label={labels.date} type="date" />
        <Field name="customerExternalId" label={labels.customer} />
        <Select name="channel" label={labels.channel} options={channelOptions} />
        <Select name="governorate" label={labels.governorate} options={governorateOptions} />
        <Select name="fulfillmentMethod" label={labels.fulfillment} options={fulfillmentOptions} />
        <Select name="status" label={labels.status} options={statusOptions} />
        <Field name="deliveryFee" label={labels.deliveryFee} type="number" />
        <Field name="deliveryCost" label={labels.deliveryCost} type="number" />
      </div>

      <div className="rounded-[var(--radius)] border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{labels.items}</h3>
          <button
            type="button"
            onClick={() => setLines((ls) => [...ls, { ...emptyLine }])}
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-muted"
          >
            <Plus className="size-3.5" />
            {labels.addLine}
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] items-end gap-2">
              <div className="flex flex-col gap-1">
                {i === 0 ? <label className="text-xs text-muted-foreground">{labels.sku}</label> : null}
                <input value={l.sku} onChange={(e) => setLine(i, 'sku', e.target.value)} className={input} />
              </div>
              <div className="flex flex-col gap-1">
                {i === 0 ? <label className="text-xs text-muted-foreground">{labels.qty}</label> : null}
                <input type="number" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} className={input} />
              </div>
              <div className="flex flex-col gap-1">
                {i === 0 ? <label className="text-xs text-muted-foreground">{labels.unitPrice}</label> : null}
                <input type="number" value={l.unitGrossPrice} onChange={(e) => setLine(i, 'unitGrossPrice', e.target.value)} className={input} />
              </div>
              <div className="flex flex-col gap-1">
                {i === 0 ? <label className="text-xs text-muted-foreground">{labels.discount}</label> : null}
                <input type="number" value={l.lineDiscount} onChange={(e) => setLine(i, 'lineDiscount', e.target.value)} className={input} />
              </div>
              <button
                type="button"
                onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))}
                className="mb-1 rounded-lg border p-2 text-muted-foreground hover:bg-muted"
                aria-label={labels.removeLine}
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {state?.error ? <p className="text-sm font-medium text-danger">{errors[state.error] ?? state.error}</p> : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {labels.create}
        </button>
        <Link href={cancelHref} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted">
          {labels.cancel}
        </Link>
      </div>
    </form>
  );
}
