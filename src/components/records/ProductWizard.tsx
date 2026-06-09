'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ChevronRight, ChevronLeft, Check } from 'lucide-react';
import { createProductWizard } from '@/server/records/product-wizard';
import type { ActionState } from '@/server/records/shared';

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';
type Opt = { value: string; label: string };

const STEP_KEYS = ['basics', 'variation', 'pricing', 'cost', 'behaviour', 'review'] as const;

export function ProductWizard({
  locale,
  productLines,
  grinds,
}: {
  locale: string;
  productLines: Opt[];
  grinds: Opt[];
}) {
  const t = useTranslations('records');
  const [state, action, pending] = useActionState<ActionState, FormData>(createProductWizard, undefined);
  const [step, setStep] = useState(0);
  const [v, setV] = useState<Record<string, string>>({
    productLine: productLines[0]?.value ?? '',
    grind: grinds[0]?.value ?? '',
    status: 'active',
  });
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  const [bools, setBools] = useState({ trackInventory: true, allowDiscount: true, allowPriceOverride: true });

  const price = Number(v.sellingPrice || 0);
  const cogs = Number(v.cogsPerUnit || 0);
  const marginPct = price > 0 ? ((price - cogs) / price) * 100 : 0;

  // Required fields gating each step's "Next".
  const required: Record<number, string[]> = { 0: ['nameEn', 'nameAr'], 1: ['sku', 'sizeLabel'], 2: ['sellingPrice'], 3: ['cogsPerUnit'] };
  const canAdvance = (required[step] ?? []).every((k) => (v[k] ?? '').trim() !== '');

  const field = (name: string, label: string, type = 'text', hint?: string) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input name={name} type={type} value={v[name] ?? ''} onChange={(e) => set(name, e.target.value)} className={input} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
  const select = (name: string, label: string, opts: Opt[]) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <select name={name} value={v[name] ?? ''} onChange={(e) => set(name, e.target.value)} className={input}>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
  const check = (name: keyof typeof bools, label: string, hint: string) => (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 hover:bg-muted/40">
      <input type="checkbox" name={name} checked={bools[name]} onChange={(e) => setBools((p) => ({ ...p, [name]: e.target.checked }))} className="mt-0.5 size-4 accent-primary" />
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />

      {/* Stepper */}
      <ol className="flex flex-wrap gap-1 text-xs">
        {STEP_KEYS.map((k, i) => (
          <li
            key={k}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${i === step ? 'bg-primary text-primary-foreground' : i < step ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground'}`}
          >
            {i < step ? <Check className="size-3" /> : <span>{i + 1}</span>}
            {t(`wizard.steps.${k}`)}
          </li>
        ))}
      </ol>

      <div className="rounded-[var(--radius)] border bg-card p-4">
        {step === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {field('nameEn', t('f.nameEn'))}
            {field('nameAr', t('f.nameAr'))}
            {select('productLine', t('f.category'), productLines)}
            {field('productType', t('f.productType'), 'text', t('f.productTypeHint'))}
            <div className="sm:col-span-2">{field('description', t('f.description'))}</div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {field('sku', t('f.sku'), 'text', t('wizard.skuHint'))}
            {field('sizeLabel', t('f.size'), 'text', t('wizard.sizeHint'))}
            {select('grind', t('f.grind'), grinds)}
            {field('variationType', t('f.variationType'), 'text', t('f.variationTypeHint'))}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {field('sellingPrice', t('f.price'), 'number')}
            {field('minSellingPrice', t('usage.minSellingPrice'), 'number')}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">{field('cogsPerUnit', t('f.cost'), 'number', t('f.costHint'))}</div>
            <p className="text-sm">
              {t('rep.grossMargin')}: <strong>{marginPct.toFixed(1)}%</strong>
            </p>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-2">
            {check('trackInventory', t('usage.trackInventory'), t('usage.trackInventoryHint'))}
            {check('allowDiscount', t('usage.allowDiscount'), t('usage.allowDiscountHint'))}
            {check('allowPriceOverride', t('usage.allowPriceOverride'), t('usage.allowPriceOverrideHint'))}
            <p className="text-xs text-muted-foreground">{t('wizard.behaviourHint')}</p>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="space-y-3">
            <dl className="grid gap-px overflow-hidden rounded-[var(--radius)] border bg-border sm:grid-cols-2">
              {[
                [t('f.mainProduct'), v.nameEn],
                [t('f.sku'), v.sku],
                [t('f.size'), v.sizeLabel],
                [t('f.price'), v.sellingPrice],
                [t('f.cost'), v.cogsPerUnit],
                [t('rep.grossMargin'), `${marginPct.toFixed(1)}%`],
              ].map(([label, val], i) => (
                <div key={i} className="bg-card px-4 py-2">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-sm font-medium">{val || '—'}</dd>
                </div>
              ))}
            </dl>
            {select('status', t('wizard.status'), [
              { value: 'active', label: t('wizard.active') },
              { value: 'draft', label: t('wizard.draft') },
            ])}
          </div>
        ) : null}

        {state?.error ? <p className="mt-3 text-sm font-medium text-danger">{state.error === 'exists' ? t('err.exists') : t('err.invalid')}</p> : null}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-40"
        >
          <ChevronLeft className="size-4 rtl:rotate-180" />
          {t('wizard.back')}
        </button>

        {step < STEP_KEYS.length - 1 ? (
          <button
            type="button"
            onClick={() => canAdvance && setStep((s) => s + 1)}
            disabled={!canAdvance}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50"
          >
            {t('wizard.next')}
            <ChevronRight className="size-4 rtl:rotate-180" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {t('wizard.finish')}
          </button>
        )}
      </div>
    </form>
  );
}
