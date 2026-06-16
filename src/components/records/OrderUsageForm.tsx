'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { saveOrderUsage } from '@/server/records/products';
import type { ActionState } from '@/server/records/shared';

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

/** How a variation behaves in orders/invoices (§6): invoice name, price floor,
 * and the discount / price-override / stock-tracking toggles. */
export function OrderUsageForm({
  productId,
  locale,
  initial,
  unitOptions,
}: {
  productId: string;
  locale: string;
  unitOptions: { value: string; label: string }[];
  initial: {
    invoiceName: string;
    sellUnit: string;
    minSellingPrice: string;
    allowDiscount: boolean;
    allowPriceOverride: boolean;
    trackInventory: boolean;
  };
}) {
  const t = useTranslations('records');
  const [state, action, pending] = useActionState<ActionState, FormData>(saveOrderUsage.bind(null, productId), undefined);

  const toggles: { name: 'allowDiscount' | 'allowPriceOverride' | 'trackInventory'; label: string; hint: string }[] = [
    { name: 'allowDiscount', label: t('usage.allowDiscount'), hint: t('usage.allowDiscountHint') },
    { name: 'allowPriceOverride', label: t('usage.allowPriceOverride'), hint: t('usage.allowPriceOverrideHint') },
    { name: 'trackInventory', label: t('usage.trackInventory'), hint: t('usage.trackInventoryHint') },
  ];

  return (
    <form action={action} className="grid gap-4 rounded-[var(--radius)] border bg-card p-4 sm:grid-cols-2">
      <input type="hidden" name="locale" value={locale} />
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">{t('usage.invoiceName')}</label>
        <input name="invoiceName" type="text" defaultValue={initial.invoiceName} placeholder={t('usage.invoiceNameHint')} className={input} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">{t('usage.sellUnit')}</label>
        <select name="sellUnit" defaultValue={initial.sellUnit || 'unit'} className={input}>
          {unitOptions.map((unit) => (
            <option key={unit.value} value={unit.value}>
              {unit.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">{t('usage.minSellingPrice')}</label>
        <input name="minSellingPrice" type="number" defaultValue={initial.minSellingPrice} placeholder="0" className={input} />
      </div>

      <div className="space-y-2 sm:col-span-2">
        {toggles.map((tg) => (
          <label key={tg.name} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
            <input type="checkbox" name={tg.name} defaultChecked={initial[tg.name]} className="mt-0.5 size-4 accent-primary" />
            <span>
              <span className="block text-sm font-medium text-foreground">{tg.label}</span>
              <span className="block text-xs text-muted-foreground">{tg.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {state?.error ? <p className="text-sm font-medium text-danger sm:col-span-2">{t('err.invalid')}</p> : null}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {t('save')}
        </button>
      </div>
    </form>
  );
}
