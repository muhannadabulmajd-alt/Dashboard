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
/** A selectable variation for the order line picker. */
export type CatalogItem = { sku: string; name: string; group: string; price: number };
const emptyLine: OrderLineInput = { sku: '', quantity: '1', unitGrossPrice: '0', lineDiscount: '0' };

// Header inputs are defined at module scope so re-renders (line edits) don't
// remount them and wipe their values.
function HeaderField({
  name,
  label,
  type = 'text',
  defaultValue,
  disabled,
  hint,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  disabled?: boolean;
  hint?: string;
}) {
  const fieldId = `${name}-field`;
  const hintId = `${name}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        id={fieldId}
        name={disabled ? undefined : name}
        type={type}
        defaultValue={defaultValue}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        className={cn(input, disabled && disabledInput)}
      />
      {disabled ? <input type="hidden" name={name} value={defaultValue ?? ''} /> : null}
      {hint ? <p id={hintId} className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function HeaderSelect({ name, label, options, defaultValue, hint }: { name: string; label: string; options: Opt[]; defaultValue?: string; hint?: string }) {
  const fieldId = `${name}-field`;
  const hintId = `${name}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-xs font-medium text-muted-foreground">{label}</label>
      <select id={fieldId} name={name} className={input} defaultValue={defaultValue ?? options[0]?.value} aria-describedby={hint ? hintId : undefined}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <p id={hintId} className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
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
  accountOptions,
  labels,
  errors,
  cancelHref,
  initial,
  submitLabel,
  editing,
  catalog = [],
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  locale: string;
  channelOptions: Opt[];
  governorateOptions: Opt[];
  fulfillmentOptions: Opt[];
  statusOptions: Opt[];
  accountOptions: Opt[];
  labels: Record<string, string>;
  errors: Record<string, string>;
  cancelHref: string;
  initial?: OrderInitial;
  submitLabel: string;
  editing?: boolean;
  catalog?: CatalogItem[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [lines, setLines] = useState<OrderLineInput[]>(initial?.lines?.length ? initial.lines : [{ ...emptyLine }]);

  // Active variations grouped by parent for the picker (BRD §11–12).
  const catalogByGroup = useMemo(() => {
    const m = new Map<string, CatalogItem[]>();
    for (const c of catalog) {
      const arr = m.get(c.group) ?? [];
      arr.push(c);
      m.set(c.group, arr);
    }
    return [...m.entries()];
  }, [catalog]);
  const priceBySku = useMemo(() => new Map(catalog.map((c) => [c.sku, c.price])), [catalog]);

  // Selecting a variation fills the SKU and auto-fills its price (overridable).
  const pickVariation = (i: number, sku: string) =>
    setLines((ls) =>
      ls.map((l, idx) =>
        idx === i ? { ...l, sku, unitGrossPrice: priceBySku.has(sku) ? String(priceBySku.get(sku)) : l.unitGrossPrice } : l,
      ),
    );
  const h = initial?.header ?? {};
  // Order-level adjustments are controlled so the live total reflects them.
  const [adj, setAdj] = useState({
    orderDiscount: initial?.header?.orderDiscount ?? '0',
    extraCharges: initial?.header?.extraCharges ?? '0',
  });
  const [financeMode, setFinanceMode] = useState(initial?.header?.financeMode ?? 'CREDIT');

  const setLine = (i: number, k: keyof OrderLineInput, v: string) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  // Live recalculation so the user sees the new total before saving (CR-2/8).
  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + (Number(l.unitGrossPrice) || 0) * (Number(l.quantity) || 0), 0);
    const lineDisc = lines.reduce((s, l) => s + (Number(l.lineDiscount) || 0), 0);
    const discount = lineDisc + (Number(adj.orderDiscount) || 0);
    const extra = Number(adj.extraCharges) || 0;
    return { subtotal, discount, extra, net: subtotal - discount + extra };
  }, [lines, adj]);
  const fmt = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-IQ' : 'en-US').format(n);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />

      <div className="grid gap-3 rounded-[var(--radius)] border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1 sm:col-span-2 lg:col-span-3">
          <h2 className="text-sm font-semibold text-foreground">{labels.detailsTitle}</h2>
          <p className="text-xs leading-5 text-muted-foreground">{labels.detailsHint}</p>
        </div>
        <HeaderField name="orderNumber" label={labels.orderNumber} defaultValue={h.orderNumber} disabled={editing} />
        <HeaderField name="placedAt" label={labels.date} type="date" defaultValue={h.placedAt} />
        <div className="space-y-1">
          <HeaderField name="customerExternalId" label={labels.customer} defaultValue={h.customerExternalId} hint={labels.customerHint} />
          <Link href="/admin/records/customers/new" className="inline-flex text-xs font-medium text-primary hover:underline">
            {labels.newCustomer}
          </Link>
        </div>
        <HeaderSelect name="channel" label={labels.channel} options={channelOptions} defaultValue={h.channel} />
        <HeaderSelect name="governorate" label={labels.governorate} options={governorateOptions} defaultValue={h.governorate} />
        <HeaderSelect name="fulfillmentMethod" label={labels.fulfillment} options={fulfillmentOptions} defaultValue={h.fulfillmentMethod} />
        <HeaderSelect name="status" label={labels.status} options={statusOptions} defaultValue={h.status} />
        <HeaderField name="deliveryFee" label={labels.deliveryFee} type="number" defaultValue={h.deliveryFee} />
        <HeaderField name="deliveryCost" label={labels.deliveryCost} type="number" defaultValue={h.deliveryCost} />
        <HeaderField name="notes" label={labels.notes} defaultValue={h.notes} />
      </div>

      <div className="grid gap-3 rounded-[var(--radius)] border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1 sm:col-span-2 lg:col-span-3">
          <h2 className="text-sm font-semibold text-foreground">{labels.paymentTitle}</h2>
          <p className="text-xs leading-5 text-muted-foreground">{labels.paymentHint}</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="finance-mode-field" className="text-xs font-medium text-muted-foreground">{labels.financeMode}</label>
          <select
            id="finance-mode-field"
            name="financeMode"
            value={financeMode}
            onChange={(e) => setFinanceMode(e.target.value)}
            className={input}
          >
            <option value="CREDIT">{labels.financeCredit}</option>
            <option value="PAID">{labels.financePaid}</option>
            <option value="NONE">{labels.financeNone}</option>
          </select>
        </div>
        {financeMode === 'PAID' ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="finance-account-field" className="text-xs font-medium text-muted-foreground">{labels.paymentAccount}</label>
            <select id="finance-account-field" name="financeAccountId" required className={input} defaultValue={h.financeAccountId}>
              <option value="">—</option>
              {accountOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {financeMode === 'CREDIT' ? (
          <HeaderField name="financeDueDate" label={labels.paymentDueDate} type="date" defaultValue={h.financeDueDate || h.placedAt} />
        ) : null}
      </div>

      <div className="rounded-[var(--radius)] border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">{labels.items}</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{labels.itemsHint}</p>
          </div>
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
                {i === 0 ? <label className="text-xs text-muted-foreground">{labels.variation ?? labels.sku}</label> : null}
                {catalog.length ? (
                  <select value={l.sku} onChange={(e) => pickVariation(i, e.target.value)} className={input}>
                    <option value="">—</option>
                    {catalogByGroup.map(([group, items]) => (
                      <optgroup key={group} label={group}>
                        {items.map((c) => (
                          <option key={c.sku} value={c.sku}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    {l.sku && !priceBySku.has(l.sku) ? <option value={l.sku}>{l.sku}</option> : null}
                  </select>
                ) : (
                  <input value={l.sku} onChange={(e) => setLine(i, 'sku', e.target.value)} className={input} />
                )}
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

        <div className="mt-3 grid gap-2 border-t pt-3 sm:max-w-sm">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{labels.orderDiscount}</label>
            <input
              type="number"
              name="orderDiscount"
              value={adj.orderDiscount}
              onChange={(e) => setAdj((a) => ({ ...a, orderDiscount: e.target.value }))}
              className={input}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{labels.extraCharges}</label>
            <input
              type="number"
              name="extraCharges"
              value={adj.extraCharges}
              onChange={(e) => setAdj((a) => ({ ...a, extraCharges: e.target.value }))}
              className={input}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 border-t pt-3 text-sm">
          <span className="text-muted-foreground">{labels.subtotal}: <span className="font-semibold tabular-nums text-foreground">{fmt(totals.subtotal)}</span></span>
          <span className="text-muted-foreground">{labels.discount}: <span className="font-semibold tabular-nums text-foreground">{fmt(totals.discount)}</span></span>
          {totals.extra ? <span className="text-muted-foreground">{labels.extraCharges}: <span className="font-semibold tabular-nums text-foreground">{fmt(totals.extra)}</span></span> : null}
          <span className="text-muted-foreground">{labels.total}: <span className="font-bold tabular-nums text-foreground">{fmt(totals.net)}</span></span>
        </div>
      </div>

      {state?.error ? <p className="text-sm font-medium text-danger">{errors[state.error] ?? state.error}</p> : null}

      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border bg-card p-3 shadow-sm">
        <div className="me-auto">
          <div className="text-xs font-medium text-muted-foreground">{labels.reviewTitle}</div>
          <div className="text-lg font-bold tabular-nums text-foreground">{fmt(totals.net)}</div>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {submitLabel}
        </button>
        <Link href={cancelHref} className="inline-flex min-h-10 items-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted">
          {labels.cancel}
        </Link>
      </div>
    </form>
  );
}
