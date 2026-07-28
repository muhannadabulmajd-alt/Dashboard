'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, Plus, ScanLine, Search, UserRound, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { ActionState } from '@/server/records/shared';

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';
const inputError = 'border-danger focus:border-danger';
const disabledInput = 'cursor-not-allowed bg-muted text-muted-foreground';
const rowLabel = (first: boolean) => first ? 'text-xs text-muted-foreground' : 'text-xs text-muted-foreground sm:hidden';

type Opt = { value: string; label: string };
export type OrderLineInput = { sku: string; quantity: string; unitGrossPrice: string; lineDiscount: string };
export type OrderInitial = { header: Record<string, string>; lines: OrderLineInput[] };
/** A selectable variation for the order line picker. */
export type CatalogItem = {
  sku: string;
  name: string;
  group: string;
  price: number;
  unit: string;
  barcodeValue: string;
  retailBarcode: string;
};
export type CustomerOption = { externalId: string; label: string; phone?: string | null };
export type OrderPaymentSummary = {
  total: number;
  paid: number;
  remaining: number;
  status: string;
  statusLabel: string;
  route: string;
  routeLabel: string;
  providerName?: string | null;
  providerOutstanding?: number;
};
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
  error,
  value,
  onValueChange,
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
  error?: string;
  value?: string;
  onValueChange?: (value: string) => void;
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
        {...(value === undefined ? { defaultValue } : { value })}
        onChange={onValueChange ? (event) => onValueChange(event.target.value) : undefined}
        disabled={disabled}
        required={required}
        min={min}
        step={step}
        aria-describedby={hint ? hintId : undefined}
        aria-invalid={Boolean(error)}
        className={cn(input, disabled && disabledInput, error && inputError)}
      />
      {disabled ? <input type="hidden" name={name} value={defaultValue ?? ''} /> : null}
      {hint ? <p id={hintId} className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
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
  error,
  value,
  onValueChange,
}: {
  name: string;
  label: string;
  options: Opt[];
  defaultValue?: string;
  hint?: string;
  required?: boolean;
  error?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  const fieldId = `${name}-field`;
  const hintId = `${name}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-xs font-medium text-muted-foreground">{label}</label>
      <select
        id={fieldId}
        name={name}
        className={cn(input, error && inputError)}
        {...(value === undefined
          ? { defaultValue: defaultValue ?? options[0]?.value ?? '' }
          : { value })}
        onChange={onValueChange ? (event) => onValueChange(event.target.value) : undefined}
        required={required}
        aria-describedby={hint ? hintId : undefined}
        aria-invalid={Boolean(error)}
      >
        {!options.length ? <option value="">—</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <p id={hintId} className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
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

function CustomerPicker({
  customers,
  selectedCustomer,
  onSelect,
  labels,
  error,
}: {
  customers: CustomerOption[];
  selectedCustomer: string;
  onSelect: (customerExternalId: string) => void;
  labels: Record<string, string>;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = customers.find((customer) => customer.externalId === selectedCustomer);
  const visibleCustomers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? customers.filter((customer) => `${customer.label} ${customer.phone ?? ''} ${customer.externalId}`.toLowerCase().includes(q))
      : customers;
    return filtered.slice(0, 100);
  }, [customers, query]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => searchRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [open]);

  const pick = (externalId: string) => {
    onSelect(externalId);
    setOpen(false);
  };

  const modal = open && typeof document !== 'undefined'
    ? createPortal(
        <div className="fixed inset-0 z-50 flex items-end bg-roast/35 p-0 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[88vh] w-full flex-col rounded-t-2xl border bg-card shadow-xl sm:max-w-2xl sm:rounded-[var(--radius)]">
            <div className="flex items-start justify-between gap-3 border-b p-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">{labels.customerPickerTitle ?? labels.selectCustomer}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{labels.customerPickerHint ?? labels.customerHint}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border p-2 text-muted-foreground hover:bg-muted" aria-label={labels.cancel}>
                <X className="size-4" />
              </button>
            </div>
            <div className="sticky top-0 z-10 border-b bg-card p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={labels.searchCustomer}
                  className={cn(input, 'ps-9')}
                  data-customer-picker-search
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
              {visibleCustomers.length ? visibleCustomers.map((customer) => {
                const active = customer.externalId === selectedCustomer;
                return (
                  <button
                    key={customer.externalId}
                    type="button"
                    onClick={() => pick(customer.externalId)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-lg border p-3 text-start transition hover:border-primary hover:bg-primary/5',
                      active && 'border-primary bg-primary/10',
                    )}
                    data-customer-picker-option={customer.externalId}
                  >
                    <span className="mt-0.5 rounded-lg bg-muted p-2 text-muted-foreground">
                      <UserRound className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-semibold text-foreground">{customer.label}</span>
                      {customer.phone ? <span className="mt-1 block text-xs text-muted-foreground">{customer.phone}</span> : null}
                    </span>
                    {active ? <Check className="mt-1 size-4 shrink-0 text-primary" /> : null}
                  </button>
                );
              }) : (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {labels.noCustomersFound ?? labels.customer}
                </div>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">
              {selectedCustomer ? (
                <button type="button" onClick={() => onSelect('')} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
                  {labels.clearCustomer ?? labels.cancel}
                </button>
              ) : null}
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
                {labels.done ?? labels.selectCustomer}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="space-y-1" data-order-customer-picker>
      <label className="text-xs font-medium text-muted-foreground">{labels.customer}</label>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-start text-sm outline-none hover:border-primary',
          error && inputError,
        )}
        aria-invalid={Boolean(error)}
        data-customer-picker-trigger
      >
        <span className={cn('min-w-0 flex-1 break-words', !selected && 'text-muted-foreground')}>
          {selected?.label ?? (selectedCustomer || labels.selectCustomer)}
        </span>
        <Search className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
      {selected ? (
        <button type="button" onClick={() => onSelect('')} className="text-xs font-medium text-muted-foreground hover:text-primary">
          {labels.clearCustomer ?? labels.cancel}
        </button>
      ) : null}
      {modal}
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
  providerOptions,
  saleStatusValues,
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
  paymentSummary,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  locale: string;
  channelOptions: Opt[];
  governorateOptions: Opt[];
  fulfillmentOptions: Opt[];
  statusOptions: Opt[];
  accountOptions: Opt[];
  providerOptions?: Opt[];
  saleStatusValues?: string[];
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
  paymentSummary?: OrderPaymentSummary;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [lines, setLines] = useState<OrderLineInput[]>(initial?.lines?.length ? initial.lines : [{ ...emptyLine }]);
  const [customers, setCustomers] = useState<CustomerOption[]>(customerOptions);
  const [selectedCustomer, setSelectedCustomer] = useState(initial?.header?.customerExternalId ?? '');
  const [status, setStatus] = useState(initial?.header?.status ?? statusOptions[0]?.value ?? '');
  const [deliveryFee, setDeliveryFee] = useState(initial?.header?.deliveryFee ?? '0');
  const [scanValue, setScanValue] = useState('');
  const [scanMessage, setScanMessage] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const fieldErrors = state?.fieldErrors ?? {};
  const errorFor = (field: string) => {
    const code = fieldErrors[field];
    return code ? errors[code] ?? code : undefined;
  };

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
  const catalogByBarcode = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    for (const item of catalog) {
      map.set(item.sku.trim().toUpperCase(), item);
      map.set(item.barcodeValue.trim().toUpperCase(), item);
      map.set(item.retailBarcode.trim(), item);
    }
    return map;
  }, [catalog]);

  // Selecting a variation fills the SKU and auto-fills its price (overridable).
  const pickVariation = (i: number, sku: string) =>
    setLines((ls) =>
      ls.map((l, idx) =>
        idx === i ? { ...l, sku, unitGrossPrice: priceBySku.has(sku) ? String(priceBySku.get(sku)) : l.unitGrossPrice } : l,
      ),
    );
  const addScannedVariation = () => {
    const key = scanValue.trim();
    if (!key) return;
    const item = catalogByBarcode.get(key.toUpperCase()) ?? catalogByBarcode.get(key);
    if (!item) {
      setScanMessage(labels.scanNotFound ?? labels.sku);
      return;
    }
    setLines((current) => {
      const existingIndex = current.findIndex((line) => line.sku === item.sku);
      if (existingIndex >= 0) {
        return current.map((line, index) =>
          index === existingIndex
            ? { ...line, quantity: String((Number(line.quantity) || 0) + 1) }
            : line,
        );
      }
      const emptyIndex = current.findIndex((line) => !line.sku);
      const scannedLine = {
        sku: item.sku,
        quantity: '1',
        unitGrossPrice: String(item.price),
        lineDiscount: '0',
      };
      if (emptyIndex >= 0) {
        return current.map((line, index) => (index === emptyIndex ? scannedLine : line));
      }
      return [...current, scannedLine];
    });
    setScanValue('');
    setScanMessage((labels.scanAdded ?? '{name}').replace('{name}', item.name));
  };
  const h = initial?.header ?? {};
  // Order-level adjustments are controlled so the live total reflects them.
  const [adj, setAdj] = useState({
    orderDiscount: initial?.header?.orderDiscount ?? '0',
    extraCharges: initial?.header?.extraCharges ?? '0',
  });
  const [financeMode, setFinanceMode] = useState(
    editing
      ? 'KEEP'
      : initial?.header?.financeMode ?? 'AUTO',
  );

  const setLine = (i: number, k: keyof OrderLineInput, v: string) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  // Live recalculation so the user sees the new total before saving (CR-2/8).
  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + (Number(l.unitGrossPrice) || 0) * (Number(l.quantity) || 0), 0);
    const lineDisc = lines.reduce((s, l) => s + (Number(l.lineDiscount) || 0), 0);
    const discount = lineDisc + (Number(adj.orderDiscount) || 0);
    const extra = Number(adj.extraCharges) || 0;
    const delivery = Number(deliveryFee) || 0;
    return { subtotal, discount, extra, delivery, net: subtotal - discount + extra + delivery };
  }, [lines, adj, deliveryFee]);
  const completionNeedsPayment =
    (saleStatusValues ?? []).includes(status) &&
    totals.net > (paymentSummary?.paid ?? 0);
  const effectiveFinanceMode =
    completionNeedsPayment && financeMode === 'KEEP'
      ? 'AUTO'
      : completionNeedsPayment &&
          financeMode !== 'AUTO' &&
          financeMode !== 'PAID' &&
          financeMode !== 'PROVIDER'
        ? 'AUTO'
      : financeMode;
  const fmt = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-IQ' : 'en-US').format(n);
  const addInlineCustomer = (customer: CustomerOption) => {
    setCustomers((current) => current.some((item) => item.externalId === customer.externalId) ? current : [customer, ...current]);
    setSelectedCustomer(customer.externalId);
  };
  useEffect(() => {
    if (state?.error) errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [state?.error]);

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
        <HeaderField name="placedAt" label={labels.date} type="date" defaultValue={h.placedAt} required error={errorFor('placedAt')} />
        <div className="space-y-1">
          <input type="hidden" name="customerExternalId" value={selectedCustomer} />
          <CustomerPicker
            customers={customers}
            selectedCustomer={selectedCustomer}
            onSelect={setSelectedCustomer}
            labels={labels}
            error={errorFor('customerExternalId')}
          />
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
        <HeaderSelect name="channel" label={labels.channel} options={channelOptions} defaultValue={h.channel} required error={errorFor('channel')} />
        <HeaderSelect name="governorate" label={labels.governorate} options={governorateOptions} defaultValue={h.governorate} required error={errorFor('governorate')} />
        <HeaderSelect name="fulfillmentMethod" label={labels.fulfillment} options={fulfillmentOptions} defaultValue={h.fulfillmentMethod} required error={errorFor('fulfillmentMethod')} />
        <HeaderSelect
          name="status"
          label={labels.status}
          options={statusOptions}
          value={status}
          onValueChange={setStatus}
          required
          error={errorFor('status')}
        />
        <HeaderField
          name="deliveryFee"
          label={labels.deliveryFee}
          type="number"
          value={deliveryFee}
          onValueChange={setDeliveryFee}
          min="0"
          step="1"
        />
        <HeaderField name="deliveryCost" label={labels.deliveryCost} type="number" defaultValue={h.deliveryCost ?? '0'} min="0" step="1" />
        <HeaderField name="notes" label={labels.notes} defaultValue={h.notes} />
      </div>

      <div className="grid gap-3 rounded-[var(--radius)] border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1 sm:col-span-2 lg:col-span-3">
          <h2 className="text-sm font-semibold text-foreground">{labels.paymentTitle}</h2>
          <p className="text-xs leading-5 text-muted-foreground">
            {editing ? labels.paymentReadOnlyHint : labels.paymentHint}
          </p>
        </div>
        {editing && paymentSummary ? (
          <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-5">
            {[
              [labels.total, fmt(paymentSummary.total)],
              [labels.paid, fmt(paymentSummary.paid)],
              [labels.remaining, fmt(paymentSummary.remaining)],
              [labels.paymentStatus, paymentSummary.statusLabel],
              [labels.paymentRoute, paymentSummary.routeLabel],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-muted/25 p-3">
                <div className="text-xs font-medium text-muted-foreground">{label}</div>
                <div className="mt-1 break-words text-sm font-bold tabular-nums text-foreground">{value}</div>
              </div>
            ))}
            {paymentSummary.providerName ? (
              <div className="rounded-lg border bg-muted/25 p-3 sm:col-span-2 lg:col-span-3">
                <div className="text-xs font-medium text-muted-foreground">{labels.provider}</div>
                <div className="mt-1 text-sm font-bold text-foreground">{paymentSummary.providerName}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {labels.providerOutstanding}: {fmt(paymentSummary.providerOutstanding ?? 0)}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {editing && !completionNeedsPayment ? (
          <input type="hidden" name="financeMode" value="KEEP" />
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor="finance-mode-field" className="text-xs font-medium text-muted-foreground">{labels.financeMode}</label>
            <select
              id="finance-mode-field"
              name="financeMode"
              value={effectiveFinanceMode}
              onChange={(e) => setFinanceMode(e.target.value)}
              className={cn(input, errorFor('financeMode') && inputError)}
              aria-invalid={Boolean(errorFor('financeMode'))}
              required={completionNeedsPayment}
            >
              {completionNeedsPayment ? <option value="">{labels.choosePaymentRoute}</option> : null}
              <option value="AUTO">{labels.financeAuto}</option>
              {!editing && !completionNeedsPayment ? <option value="CREDIT">{labels.financeCredit}</option> : null}
              <option value="PAID">{labels.financePaid}</option>
              {!editing && !completionNeedsPayment ? <option value="PARTIAL">{labels.financePartial}</option> : null}
              {!editing && !completionNeedsPayment ? <option value="NONE">{labels.financeNone}</option> : null}
            </select>
            {completionNeedsPayment ? <p className="text-xs leading-5 text-warning">{labels.completionPaymentHint}</p> : null}
            {errorFor('financeMode') ? <p className="text-xs font-medium text-danger">{errorFor('financeMode')}</p> : null}
          </div>
        )}
        {(effectiveFinanceMode === 'PAID' || effectiveFinanceMode === 'PARTIAL') && (!editing || completionNeedsPayment) ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="finance-account-field" className="text-xs font-medium text-muted-foreground">{labels.paymentAccount}</label>
            <select
              id="finance-account-field"
              name="financeAccountId"
              required
              className={cn(input, errorFor('financeAccountId') && inputError)}
              defaultValue={h.financeAccountId ?? ''}
              aria-invalid={Boolean(errorFor('financeAccountId'))}
            >
              <option value="">—</option>
              {accountOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {errorFor('financeAccountId') ? <p className="text-xs font-medium text-danger">{errorFor('financeAccountId')}</p> : null}
          </div>
        ) : null}
        {effectiveFinanceMode === 'PARTIAL' && (!editing || completionNeedsPayment) ? (
          <HeaderField name="financePaidAmount" label={labels.financePaidAmount} type="number" defaultValue={h.financePaidAmount} required min="1" step="1" error={errorFor('financePaidAmount')} />
        ) : null}
        {effectiveFinanceMode === 'PROVIDER' && (!editing || completionNeedsPayment) ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="finance-provider-field" className="text-xs font-medium text-muted-foreground">{labels.provider}</label>
            <select
              id="finance-provider-field"
              name="financeProviderId"
              required
              className={cn(input, errorFor('financeProviderId') && inputError)}
              defaultValue={h.financeProviderId ?? ''}
              aria-invalid={Boolean(errorFor('financeProviderId'))}
            >
              <option value="">—</option>
              {(providerOptions ?? []).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {errorFor('financeProviderId') ? <p className="text-xs font-medium text-danger">{errorFor('financeProviderId')}</p> : null}
          </div>
        ) : null}
        {(effectiveFinanceMode === 'PAID' || effectiveFinanceMode === 'PARTIAL' || effectiveFinanceMode === 'PROVIDER') && (!editing || completionNeedsPayment) ? (
          <>
            <HeaderSelect name="financePaymentMethod" label={labels.paymentMethod} options={paymentMethodOptions ?? []} defaultValue={h.financePaymentMethod} />
            <HeaderField name="financePaymentDate" label={labels.paymentDate} type="date" defaultValue={h.financePaymentDate || h.placedAt} required error={errorFor('financePaymentDate')} />
          </>
        ) : null}
        {effectiveFinanceMode === 'CREDIT' ? (
          <HeaderField name="financeDueDate" label={labels.paymentDueDate} type="date" defaultValue={h.financeDueDate || h.placedAt} required error={errorFor('financeDueDate')} />
        ) : null}
      </div>

      <div className={cn('rounded-[var(--radius)] border bg-card p-4', errorFor('lines') && 'border-danger')}>
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
        <div className="mb-3 rounded-lg border bg-muted/20 p-3">
          <label htmlFor="order-barcode-scan" className="text-xs font-semibold text-foreground">
            {labels.scanBarcode}
          </label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <ScanLine className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="order-barcode-scan"
                value={scanValue}
                onChange={(event) => setScanValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addScannedVariation();
                  }
                }}
                autoComplete="off"
                inputMode="numeric"
                placeholder={labels.scanBarcodeHint}
                className={cn(input, 'ps-9')}
                data-order-barcode-scan
              />
            </div>
            <button
              type="button"
              onClick={addScannedVariation}
              className="min-h-10 rounded-lg border bg-card px-4 text-sm font-semibold hover:bg-muted"
            >
              {labels.addScannedItem}
            </button>
          </div>
          {scanMessage ? <p className="mt-2 text-xs font-medium text-muted-foreground">{scanMessage}</p> : null}
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border/70 bg-background/35 p-2 sm:grid-cols-[2fr_0.8fr_1fr_1fr_1fr_auto] sm:border-0 sm:bg-transparent sm:p-0">
              <div className="flex flex-col gap-1">
                <label className={rowLabel(i === 0)}>{labels.variation ?? labels.sku}</label>
                {catalog.length ? (
                  <select value={l.sku} onChange={(e) => pickVariation(i, e.target.value)} className={cn(input, errorFor('lines') && inputError)} required data-order-line-sku={i}>
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
                <input type="number" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} className={cn(input, errorFor('lines') && inputError)} required min="1" step="1" data-order-line-quantity={i} />
              </div>
              <div className="flex flex-col gap-1">
                <label className={rowLabel(i === 0)}>{labels.unitPrice}</label>
                <input type="number" value={l.unitGrossPrice} onChange={(e) => setLine(i, 'unitGrossPrice', e.target.value)} className={cn(input, errorFor('lines') && inputError)} required min="0" step="1" data-order-line-price={i} />
              </div>
              <div className="flex flex-col gap-1">
                <label className={rowLabel(i === 0)}>{labels.discount}</label>
                <input type="number" value={l.lineDiscount} onChange={(e) => setLine(i, 'lineDiscount', e.target.value)} className={cn(input, errorFor('lines') && inputError)} required min="0" step="1" data-order-line-discount={i} />
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
        {errorFor('lines') ? <p className="mt-2 text-xs font-medium text-danger">{errorFor('lines')}</p> : null}

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
          {totals.delivery ? <span className="text-muted-foreground">{labels.deliveryFee}: <span className="font-semibold tabular-nums text-foreground">{fmt(totals.delivery)}</span></span> : null}
          <span className="text-muted-foreground">{labels.total}: <span className="font-bold tabular-nums text-foreground">{fmt(totals.net)}</span></span>
        </div>
      </div>

      {state?.error ? (
        <div ref={errorRef} className="rounded-lg border border-danger/35 bg-danger/10 p-3 text-sm font-medium text-danger" data-order-error>
          <p>{state.formError ? errors[state.formError] ?? state.formError : errors[state.error] ?? state.error}</p>
          {state.debugId ? <p className="mt-1 text-xs font-normal opacity-80">Debug ID: {state.debugId}</p> : null}
        </div>
      ) : null}

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
