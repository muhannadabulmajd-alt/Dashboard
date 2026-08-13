'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, LoaderCircle, Minus, Plus, Search, ShoppingBag, UserRound, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiStreamEvent } from '@/lib/ai-assistant';
import { normalizeAssistantText } from '@/lib/ai-assistant';
import type {
  QuickOrderCatalogItem,
  QuickOrderCustomer,
  QuickOrderDefaults,
  QuickOrderOption,
} from '@/lib/ai-quick-order';
import { cn } from '@/lib/utils';

type PreparedMessage = {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  events: AiStreamEvent[];
  createdAt: string;
};

function matchesSearch(value: string, query: string): boolean {
  const tokens = normalizeAssistantText(query).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  const haystack = normalizeAssistantText(value);
  return tokens.every((token) => haystack.includes(token));
}

export type QuickOrderPrepared = {
  conversationId: string;
  messages: PreparedMessage[];
};

export function GuidedOrderComposer({
  open,
  conversationId,
  locale,
  catalog,
  customers,
  channelOptions,
  governorateOptions,
  fulfillmentOptions,
  statusOptions,
  defaults,
  onClose,
  onPrepared,
}: {
  open: boolean;
  conversationId: string | null;
  locale: 'ar' | 'en';
  catalog: QuickOrderCatalogItem[];
  customers: QuickOrderCustomer[];
  channelOptions: QuickOrderOption[];
  governorateOptions: QuickOrderOption[];
  fulfillmentOptions: QuickOrderOption[];
  statusOptions: QuickOrderOption[];
  defaults: QuickOrderDefaults;
  onClose: () => void;
  onPrepared: (result: QuickOrderPrepared) => void;
}) {
  const t = useTranslations('aiAssistant.quickOrder');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerChoiceMade, setCustomerChoiceMade] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [placedAt, setPlacedAt] = useState(defaults.placedAt);
  const [channel, setChannel] = useState(defaults.channel);
  const [governorate, setGovernorate] = useState(defaults.governorate);
  const [fulfillmentMethod, setFulfillmentMethod] = useState(defaults.fulfillmentMethod);
  const [status, setStatus] = useState(defaults.status);
  const [notes, setNotes] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      requestAnimationFrame(() => previous?.focus());
    };
  }, [open, onClose, submitting]);

  const filteredCustomers = useMemo(() => {
    return customers.filter((customer) => matchesSearch(
      `${customer.label} ${customer.phone ?? ''} ${customer.externalId}`,
      customerSearch,
    )).slice(0, 12);
  }, [customerSearch, customers]);
  const filteredCatalog = useMemo(() => {
    return catalog.filter((item) => matchesSearch(
      `${item.name} ${item.group} ${item.searchText}`,
      productSearch,
    ));
  }, [catalog, productSearch]);
  const selectedLines = useMemo(() => catalog
    .filter((item) => (quantities[item.sku] ?? 0) > 0)
    .map((item) => ({ ...item, quantity: quantities[item.sku] })), [catalog, quantities]);
  const total = selectedLines.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const chooseCustomer = (customer: QuickOrderCustomer | null) => {
    setCustomerChoiceMade(true);
    setCustomerId(customer?.externalId ?? null);
    if (!customer) return;
    const recent = customer.recentOrder;
    const recentChannel = channelOptions.some((option) => option.value === recent?.channel) ? recent?.channel : null;
    const recentGovernorate = governorateOptions.some((option) => option.value === recent?.governorate) ? recent?.governorate : null;
    const customerGovernorate = governorateOptions.some((option) => option.value === customer.governorate) ? customer.governorate : null;
    const recentFulfillment = fulfillmentOptions.some((option) => option.value === recent?.fulfillmentMethod) ? recent?.fulfillmentMethod : null;
    setChannel(recentChannel ?? defaults.channel);
    setGovernorate(recentGovernorate ?? customerGovernorate ?? defaults.governorate);
    setFulfillmentMethod(recentFulfillment ?? defaults.fulfillmentMethod);
  };

  const setQuantity = (sku: string, value: number) => {
    const quantity = Math.max(0, Math.min(999, Math.floor(value || 0)));
    setQuantities((current) => {
      if (!quantity) {
        const next = { ...current };
        delete next[sku];
        return next;
      }
      return { ...current, [sku]: quantity };
    });
  };

  const prepare = async () => {
    if (!selectedLines.length || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/ai-assistant/actions/order/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId ?? undefined,
          locale,
          customerExternalId: customerId,
          placedAt,
          channel,
          governorate,
          fulfillmentMethod,
          status,
          notes: notes.trim() || null,
          lines: selectedLines.map((item) => ({ sku: item.sku, quantity: item.quantity })),
        }),
      });
      const body = await response.json().catch(() => ({})) as QuickOrderPrepared & { message?: string; error?: string };
      if (!response.ok) throw new Error(body.message || body.error || t('prepareError'));
      onPrepared(body);
      setCustomerSearch('');
      setProductSearch('');
      setCustomerId(null);
      setCustomerChoiceMade(false);
      setQuantities({});
      setNotes('');
      setDetailsOpen(false);
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t('prepareError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={t('title')}>
      <button type="button" aria-label={t('close')} onClick={onClose} className="absolute inset-0 bg-grove/60 backdrop-blur-[2px]" />
      <div ref={dialogRef} className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-card shadow-2xl sm:h-[min(50rem,calc(100dvh-2.5rem))] sm:max-w-4xl sm:rounded-xl sm:border sm:border-border">
        <header className="flex shrink-0 items-start gap-3 border-b border-border bg-card px-4 py-3 sm:px-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-grove text-primary-foreground"><ShoppingBag className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-roast">{t('title')}</h2>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} disabled={submitting} aria-label={t('close')} className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border hover:bg-linen/40 disabled:opacity-50"><X className="size-4" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="font-bold text-roast">{t('customer')}</h3>
              {customerId ? <button type="button" onClick={() => chooseCustomer(null)} className="text-xs font-bold text-primary underline underline-offset-4">{t('clear')}</button> : null}
            </div>
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-amber/50">
              <Search className="size-4 text-muted-foreground" />
              <input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder={t('searchCustomer')} className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none" />
            </label>
            <div className="mt-2 grid max-h-44 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              <button type="button" onClick={() => chooseCustomer(null)} className={cn('flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-start', customerChoiceMade && !customerId ? 'border-amber bg-amber/10' : 'border-border hover:bg-linen/35')}>
                <UserRound className="size-4 shrink-0" />
                <span className="text-sm font-semibold">{t('walkIn')}</span>
                {customerChoiceMade && !customerId ? <Check className="ms-auto size-4 text-primary" /> : null}
              </button>
              {filteredCustomers.map((customer) => (
                <button key={customer.externalId} type="button" onClick={() => chooseCustomer(customer)} className={cn('flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-start', customerId === customer.externalId ? 'border-amber bg-amber/10' : 'border-border hover:bg-linen/35')}>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-roast">{customer.label}</span>{customer.phone ? <span className="block text-xs text-muted-foreground" dir="ltr">{customer.phone}</span> : null}</span>
                  {customerId === customer.externalId ? <Check className="size-4 shrink-0 text-primary" /> : null}
                </button>
              ))}
            </div>
          </section>

          <section className="mt-5 border-t border-border pt-5">
            <div className="mb-2 flex items-end justify-between gap-3">
              <div><h3 className="font-bold text-roast">{t('products')}</h3><p className="text-xs text-muted-foreground">{t('productsHint')}</p></div>
              <span className="rounded-full bg-linen px-2.5 py-1 text-xs font-bold text-roast">{t('selected', { count: selectedLines.length })}</span>
            </div>
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-amber/50">
              <Search className="size-4 text-muted-foreground" />
              <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder={t('searchProduct')} className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none" />
            </label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {filteredCatalog.map((item) => {
                const quantity = quantities[item.sku] ?? 0;
                return (
                  <div key={item.sku} className={cn('rounded-lg border p-3', quantity ? 'border-amber bg-amber/8' : 'border-border')}>
                    <div className="flex items-start gap-3">
                      <button type="button" onClick={() => setQuantity(item.sku, quantity ? 0 : 1)} aria-label={quantity ? t('removeProduct', { product: item.name }) : t('addProduct', { product: item.name })} className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded border', quantity ? 'border-grove bg-grove text-primary-foreground' : 'border-border bg-card')}>
                        {quantity ? <Check className="size-3.5" /> : null}
                      </button>
                      <button type="button" onClick={() => setQuantity(item.sku, quantity ? 0 : 1)} className="min-w-0 flex-1 text-start">
                        <span className="block break-words text-sm font-bold text-roast">{item.name}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{item.group} · {item.sku}</span>
                        <span className="mt-1 block text-sm font-semibold tabular text-roast">{new Intl.NumberFormat(locale === 'ar' ? 'ar-IQ' : 'en-IQ').format(item.price)} IQD</span>
                      </button>
                    </div>
                    {quantity ? (
                      <div className="mt-3 flex items-center justify-end gap-2 border-t border-border/70 pt-2">
                        <button type="button" onClick={() => setQuantity(item.sku, quantity - 1)} className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card" aria-label={t('decrease')}><Minus className="size-4" /></button>
                        <input type="number" min="1" max="999" value={quantity} onChange={(event) => setQuantity(item.sku, Number(event.target.value))} className="h-9 w-16 rounded-lg border border-border bg-background text-center text-sm font-bold tabular outline-none focus:border-amber" aria-label={t('quantity')} />
                        <button type="button" onClick={() => setQuantity(item.sku, quantity + 1)} className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card" aria-label={t('increase')}><Plus className="size-4" /></button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {!filteredCatalog.length ? <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">{t('noProducts')}</p> : null}
          </section>

          <section className="mt-5 border-t border-border pt-4">
            <button type="button" onClick={() => setDetailsOpen((value) => !value)} className="flex min-h-11 w-full items-center justify-between rounded-lg px-1 text-start font-bold text-roast">
              <span><span className="block">{t('details')}</span><span className="block text-xs font-normal text-muted-foreground">{t('detailsHint')}</span></span>
              <ChevronDown className={cn('size-4 transition-transform', detailsOpen && 'rotate-180')} />
            </button>
            {detailsOpen ? (
              <div className="mt-2 grid gap-3 rounded-lg bg-linen/25 p-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-muted-foreground">{t('date')}<input type="date" value={placedAt} onChange={(event) => setPlacedAt(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-roast" /></label>
                <OptionSelect label={t('channel')} value={channel} options={channelOptions} onChange={setChannel} />
                <OptionSelect label={t('governorate')} value={governorate} options={governorateOptions} onChange={setGovernorate} />
                <OptionSelect label={t('fulfillment')} value={fulfillmentMethod} options={fulfillmentOptions} onChange={(value) => setFulfillmentMethod(value as typeof fulfillmentMethod)} />
                <OptionSelect label={t('status')} value={status} options={statusOptions} onChange={setStatus} />
                <label className="text-xs font-semibold text-muted-foreground sm:col-span-2">{t('notes')}<textarea value={notes} maxLength={1_000} onChange={(event) => setNotes(event.target.value)} rows={2} className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-roast" /></label>
              </div>
            ) : null}
          </section>

          {error ? <div className="mt-4 rounded-lg border border-danger/25 bg-danger-soft p-3 text-sm font-semibold text-danger">{error}</div> : null}
        </div>

        <footer className="shrink-0 border-t border-border bg-card px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-5 sm:pb-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{t('reviewTotal')}</p><p className="break-words text-xl font-bold tabular text-roast">{new Intl.NumberFormat(locale === 'ar' ? 'ar-IQ' : 'en-IQ').format(total)} IQD</p></div>
            <button type="button" onClick={() => void prepare()} disabled={!customerChoiceMade || !selectedLines.length || submitting} className="inline-flex min-h-12 min-w-32 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-amber/90 disabled:opacity-40">
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <ShoppingBag className="size-4" />}
              {submitting ? t('preparing') : t('review')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function OptionSelect({ label, value, options, onChange }: { label: string; value: string; options: QuickOrderOption[]; onChange: (value: string) => void }) {
  return (
    <label className="text-xs font-semibold text-muted-foreground">{label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-roast">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
