'use client';

import { useActionState, useMemo, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { ActionState } from '@/server/records/shared';

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';
const disabledInput = 'cursor-not-allowed bg-muted text-muted-foreground';

type Opt = { value: string; label: string };
export type OrderLineInput = { sku: string; quantity: string; unitGrossPrice: string; lineDiscount: string };
export type OrderInitial = { header: Record<string, string>; lines: OrderLineInput[] };
const emptyLine: OrderLineInput = { sku: '', quantity: '1', unitGrossPrice: '0', lineDiscount: '0' };

// Header inputs are defined at module scope so re-renders (line edits) don't
// remount them and wipe their values.
function HeaderField({
  name,
  label,
  type = 'text',
  defaultValue,
  disabled,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input name={disabled ? undefined : name} type={type} defaultValue={defaultValue} disabled={disabled} className={cn(input, disabled && disabledInput)} />
      {disabled ? <input type="hidden" name={name} value={defaultValue ?? ''} /> : null}
    </div>
  );
}

function HeaderSelect({ name, label, options, defaultValue }: { name: string; label: string; options: Opt[]; defaultValue?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <select name={name} className={input} defaultValue={defaultValue ?? options[0]?.value}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

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
  initial,
  submitLabel,
  editing,
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
  initial?: OrderInitial;
  submitLabel: string;
  editing?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [lines, setLines] = useState<OrderLineInput[]>(initial?.lines?.length ? initial.lines : [{ ...emptyLine }]);
  const h = initial?.header ?? {};

  const setLine = (i: number, k: keyof OrderLineInput, v: string) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  // Live recalculation so the user sees the new total before saving (CR-2/8).
  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + (Number(l.unitGrossPrice) || 0) * (Number(l.quantity) || 0), 0);
    const discount = lines.reduce((s, l) => s + (Number(l.lineDiscount) || 0), 0);
    return { subtotal, discount, net: subtotal - discount };
  }, [lines]);
  const fmt = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-IQ' : 'en-US').format(n);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />

      <div className="grid gap-3 rounded-[var(--radius)] border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
        <HeaderField name="orderNumber" label={labels.orderNumber} defaultValue={h.orderNumber} disabled={editing} />
        <HeaderField name="placedAt" label={labels.date} type="date" defaultValue={h.placedAt} />
        <HeaderField name="customerExternalId" label={labels.customer} defaultValue={h.customerExternalId} />
        <HeaderSelect name="channel" label={labels.channel} options={channelOptions} defaultValue={h.channel} />
        <HeaderSelect name="governorate" label={labels.governorate} options={governorateOptions} defaultValue={h.governorate} />
        <HeaderSelect name="fulfillmentMethod" label={labels.fulfillment} options={fulfillmentOptions} defaultValue={h.fulfillmentMethod} />
        <HeaderSelect name="status" label={labels.status} options={statusOptions} defaultValue={h.status} />
        <HeaderField name="deliveryFee" label={labels.deliveryFee} type="number" defaultValue={h.deliveryFee} />
        <HeaderField name="deliveryCost" label={labels.deliveryCost} type="number" defaultValue={h.deliveryCost} />
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

        <div className="mt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 border-t pt-3 text-sm">
          <span className="text-muted-foreground">{labels.subtotal}: <span className="font-semibold tabular-nums text-foreground">{fmt(totals.subtotal)}</span></span>
          <span className="text-muted-foreground">{labels.discount}: <span className="font-semibold tabular-nums text-foreground">{fmt(totals.discount)}</span></span>
          <span className="text-muted-foreground">{labels.total}: <span className="font-bold tabular-nums text-foreground">{fmt(totals.net)}</span></span>
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
          {submitLabel}
        </button>
        <Link href={cancelHref} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted">
          {labels.cancel}
        </Link>
      </div>
    </form>
  );
}
