'use client';

import { useActionState, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Plus, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { ActionState } from '@/server/records/shared';

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';
const disabledInput = 'cursor-not-allowed bg-muted text-muted-foreground';
const rowLabel = (first: boolean) => first ? 'text-xs text-muted-foreground' : 'text-xs text-muted-foreground sm:hidden';

type Opt = { value: string; label: string };
export type OrderLineInput = { sku: string; quantity: string; unitGrossPrice: string; lineDiscount: string };
export type OrderInitial = { header: Record<string, string>; lines: OrderLineInput[] };
/** A selectable variation for the order line picker. */
export type CatalogItem = { sku: string; name: string; group: string; price: number; unit: string };
export type CustomerOption = { externalId: string; label: string; phone?: string | null };
type InlineCustomerState = { ok: true; customer: CustomerOption } | { error: string } | undefined;
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
  required,
  min,
  step,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  disabled?: boolean;
  hint?: string;
  required?: boolean;
  min?: string;
  step?: string;
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
        required={required}
        min={min}
        step={step}
        aria-describedby={hint ? hintId : undefined}
        className={cn(input, disabled && disabledInput)}
      />
      {disabled ? <input type="hidden" name={name} value={defaultValue ?? ''} /> : null}
      {hint ? <p id={hintId} className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function HeaderSelect({
  name,
  label,
  options,
  defaultValue,
  hint,
  required,
}: {
  name: string;
  label: string;
  options: Opt[];
  defaultValue?: string;
  hint?: string;
  required?: boolean;
}) {
  const fieldId = `${name}-field`;
  const hintId = `${name}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-xs font-medium text-muted-foreground">{label}</label>
      <select
        id={fieldId}
        name={name}
        className={input}
        defaultValue={defaultValue ?? options[0]?.value ?? ''}
        required={required}
        aria-describedby={hint ? hintId : undefined}
      >
        {!options.length ? <option value="">—</option> : null}
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

function InlineCustomerModal({
  action,
  locale,
  governorateOptions,
  labels,
  errors,
  onCreated,
}: {
  action: (prev: InlineCustomerState, fd: FormData) => Promise<InlineCustomerState>;
  locale: string;
  governorateOptions: Opt[];
  labels: Record<string, string>;
  errors: Record<string, string>;
  onCreated: (customer: CustomerOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<InlineCustomerState, FormData>(async (prev, fd) => {
    const result = await action(prev, fd);
    if (result && 'ok' in result && result.ok) {
      onCreated(result.customer);
      setOpen(false);
      return undefined;
    }
    return result;
  }, undefined);

  const modal = open && typeof document !== 'undefined'
    ? createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-roast/30 p-4">
          <div className="w-full max-w-lg rounded-[var(--radius)] border bg-card p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">{labels.newCustomer}</h3>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border p-1.5 text-muted-foreground hover:bg-muted">
                <X className="size-4" />
              </button>
            </div>
            <form action={formAction} className="grid max-h-[82vh] gap-3 overflow-y-auto sm:grid-cols-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="segment" value="NEW" />
              <HeaderField name="nameEn" label={labels.customerName} />
              <HeaderField name="phone" label={labels.customerPhone} />
              <HeaderField name="email" label={labels.customerEmail} />
              <HeaderSelect name="governorate" label={labels.governorate} options={governorateOptions} />
              <HeaderField name="address1" label={labels.customerAddress} />
              <HeaderField name="notes" label={labels.notes} />
              {state && 'error' in state ? <p className="text-sm font-medium text-danger sm:col-span-2">{errors[state.error] ?? state.error}</p> : null}
              <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
                  {labels.cancel}
                </button>
                <button type="submit" disabled={pending} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
                  {pending ? labels.saving : labels.createCustomer}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex text-xs font-medium text-primary hover:underline">
        {labels.newCustomer}
      </button>
      {modal}
    </>
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
  paymentMethodOptions,
  labels,
  errors,
  cancelHref,
  initial,
  submitLabel,
  editing,
  catalog = [],
  customerOptions = [],
  inlineCustomerAction,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  locale: string;
  channelOptions: Opt[];
  governorateOptions: Opt[];
  fulfillmentOptions: Opt[];
  statusOptions: Opt[];
  accountOptions: Opt[];
  paymentMethodOptions?: Opt[];
  labels: Record<string, string>;
  errors: Record<string, string>;
  cancelHref: string;
  initial?: OrderInitial;
  submitLabel: string;
  editing?: boolean;
  catalog?: CatalogItem[];
  customerOptions?: CustomerOption[];
  inlineCustomerAction?: (prev: InlineCustomerState, fd: FormData) => Promise<InlineCustomerState>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [lines, setLines] = useState<OrderLineInput[]>(initial?.lines?.length ? initial.lines : [{ ...emptyLine }]);
  const [customers, setCustomers] = useState<CustomerOption[]>(customerOptions);
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(initial?.header?.customerExternalId ?? '');

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
  const unitBySku = useMemo(() => new Map(catalog.map((c) => [c.sku, c.unit])), [catalog]);

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
  const visibleCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    const list = q
      ? customers.filter((customer) => `${customer.label} ${customer.phone ?? ''} ${customer.externalId}`.toLowerCase().includes(q))
      : customers;
    return list.slice(0, 80);
  }, [customers, customerQuery]);
  const addInlineCustomer = (customer: CustomerOption) => {
    setCustomers((current) => current.some((item) => item.externalId === customer.externalId) ? current : [customer, ...current]);
    setSelectedCustomer(customer.externalId);
  };

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />

      <div className="grid gap-3 rounded-[var(--radius)] border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1 sm:col-span-2 lg:col-span-3">
          <h2 className="text-sm font-semibold text-foreground">{labels.detailsTitle}</h2>
          <p className="text-xs leading-5 text-muted-foreground">{labels.detailsHint}</p>
        </div>
        {editing ? (
          <HeaderField name="orderNumber" label={labels.orderNumber} defaultValue={h.orderNumber} disabled />
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{labels.orderNumber}</span>
            <div className="rounded-lg border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">{labels.orderNumberGenerated}</div>
          </div>
        )}
        <HeaderField name="placedAt" label={labels.date} type="date" defaultValue={h.placedAt} required />
        <div className="space-y-1">
          <input type="hidden" name="customerExternalId" value={selectedCustomer} />
          <label className="text-xs font-medium text-muted-foreground">{labels.customer}</label>
          <input
            value={customerQuery}
            onChange={(event) => setCustomerQuery(event.target.value)}
            placeholder={labels.searchCustomer}
            className={input}
          />
          <select value={selectedCustomer} onChange={(event) => setSelectedCustomer(event.target.value)} className={input}>
            <option value="">{labels.selectCustomer}</option>
            {selectedCustomer && !customers.some((customer) => customer.externalId === selectedCustomer) ? (
              <option value={selectedCustomer}>{selectedCustomer}</option>
            ) : null}
            {visibleCustomers.map((customer) => (
              <option key={customer.externalId} value={customer.externalId}>
                {customer.label}
              </option>
            ))}
          </select>
          <p className="text-xs leading-5 text-muted-foreground">{labels.customerHint}</p>
          {inlineCustomerAction ? (
            <InlineCustomerModal
              action={inlineCustomerAction}
              locale={locale}
              governorateOptions={governorateOptions}
              labels={labels}
              errors={errors}
              onCreated={addInlineCustomer}
            />
          ) : (
            <Link href="/admin/records/customers/new" className="inline-flex text-xs font-medium text-primary hover:underline">
              {labels.newCustomer}
            </Link>
          )}
        </div>
        <HeaderSelect name="channel" label={labels.channel} options={channelOptions} defaultValue={h.channel} required />
        <HeaderSelect name="governorate" label={labels.governorate} options={governorateOptions} defaultValue={h.governorate} required />
        <HeaderSelect name="fulfillmentMethod" label={labels.fulfillment} options={fulfillmentOptions} defaultValue={h.fulfillmentMethod} required />
        <HeaderSelect name="status" label={labels.status} options={statusOptions} defaultValue={h.status} required />
        <HeaderField name="deliveryFee" label={labels.deliveryFee} type="number" defaultValue={h.deliveryFee ?? '0'} min="0" step="1" />
        <HeaderField name="deliveryCost" label={labels.deliveryCost} type="number" defaultValue={h.deliveryCost ?? '0'} min="0" step="1" />
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
            <option value="PARTIAL">{labels.financePartial}</option>
            <option value="NONE">{labels.financeNone}</option>
          </select>
        </div>
        {financeMode === 'PAID' || financeMode === 'PARTIAL' ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="finance-account-field" className="text-xs font-medium text-muted-foreground">{labels.paymentAccount}</label>
            <select id="finance-account-field" name="financeAccountId" required className={input} defaultValue={h.financeAccountId ?? ''}>
              <option value="">—</option>
              {accountOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {financeMode === 'PARTIAL' ? (
          <HeaderField name="financePaidAmount" label={labels.financePaidAmount} type="number" defaultValue={h.financePaidAmount} required min="1" step="1" />
        ) : null}
        {financeMode === 'PAID' || financeMode === 'PARTIAL' ? (
          <>
            <HeaderSelect name="financePaymentMethod" label={labels.paymentMethod} options={paymentMethodOptions ?? []} defaultValue={h.financePaymentMethod} />
            <HeaderField name="financePaymentDate" label={labels.paymentDate} type="date" defaultValue={h.financePaymentDate || h.placedAt} required />
          </>
        ) : null}
        {financeMode === 'CREDIT' ? (
          <HeaderField name="financeDueDate" label={labels.paymentDueDate} type="date" defaultValue={h.financeDueDate || h.placedAt} required />
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
            <div key={i} className="grid gap-2 rounded-lg border border-border/70 bg-background/35 p-2 sm:grid-cols-[2fr_0.8fr_1fr_1fr_1fr_auto] sm:border-0 sm:bg-transparent sm:p-0">
              <div className="flex flex-col gap-1">
                <label className={rowLabel(i === 0)}>{labels.variation ?? labels.sku}</label>
                {catalog.length ? (
                  <select value={l.sku} onChange={(e) => pickVariation(i, e.target.value)} className={input} required data-order-line-sku={i}>
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
                  <input value={l.sku} onChange={(e) => setLine(i, 'sku', e.target.value)} className={input} required />
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label className={rowLabel(i === 0)}>{labels.unit}</label>
                <div className="min-h-10 rounded-lg border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                  {unitBySku.get(l.sku) ?? 'unit'}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className={rowLabel(i === 0)}>{labels.qty}</label>
                <input type="number" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} className={input} required min="1" step="1" data-order-line-quantity={i} />
              </div>
              <div className="flex flex-col gap-1">
                <label className={rowLabel(i === 0)}>{labels.unitPrice}</label>
                <input type="number" value={l.unitGrossPrice} onChange={(e) => setLine(i, 'unitGrossPrice', e.target.value)} className={input} required min="0" step="1" data-order-line-price={i} />
              </div>
              <div className="flex flex-col gap-1">
                <label className={rowLabel(i === 0)}>{labels.discount}</label>
                <input type="number" value={l.lineDiscount} onChange={(e) => setLine(i, 'lineDiscount', e.target.value)} className={input} required min="0" step="1" data-order-line-discount={i} />
              </div>
              <button
                type="button"
                onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))}
                className="rounded-lg border p-2 text-muted-foreground hover:bg-muted sm:mb-1"
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
              min="0"
              step="1"
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
              min="0"
              step="1"
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

      {state?.error ? <p className="text-sm font-medium text-danger" data-order-error>{errors[state.error] ?? state.error}</p> : null}

      <div className="flex flex-col gap-3 rounded-[var(--radius)] border bg-card p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
        <div className="me-auto">
          <div className="text-xs font-medium text-muted-foreground">{labels.reviewTitle}</div>
          <div className="text-lg font-bold tabular-nums text-foreground">{fmt(totals.net)}</div>
        </div>
        <button
          type="submit"
          disabled={pending}
          data-order-submit
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-60 max-sm:w-full"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {submitLabel}
        </button>
        <Link href={cancelHref} className="inline-flex min-h-10 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted max-sm:w-full">
          {labels.cancel}
        </Link>
      </div>
    </form>
  );
}
