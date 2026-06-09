'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus } from 'lucide-react';
import { addProductPrice } from '@/server/records/product-prices';
import type { ActionState } from '@/server/records/shared';

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

/** Add a dated price entry (§6): base / wholesale / channel, effective from a
 * date. The channel picker only shows for channel prices. */
export function AddPriceForm({
  productId,
  locale,
  today,
  channels,
}: {
  productId: string;
  locale: string;
  today: string;
  channels: { value: string; label: string }[];
}) {
  const t = useTranslations('records');
  const [state, action, pending] = useActionState<ActionState, FormData>(addProductPrice.bind(null, productId), undefined);
  const [kind, setKind] = useState('BASE');

  const kinds = [
    { value: 'BASE', label: t('price.base') },
    { value: 'WHOLESALE', label: t('price.wholesale') },
    { value: 'CHANNEL', label: t('price.channel') },
  ];

  return (
    <form action={action} className="grid items-end gap-3 rounded-[var(--radius)] border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="locale" value={locale} />
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">{t('price.kind')}</label>
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
          {kinds.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
      </div>
      {kind === 'CHANNEL' ? (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{t('f.channel')}</label>
          <select name="channel" className={input}>
            {channels.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">{t('f.price')}</label>
        <input name="price" type="number" required placeholder="0" className={input} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">{t('price.effectiveFrom')}</label>
        <input name="effectiveFrom" type="date" required defaultValue={today} className={input} />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
        <label className="text-xs font-medium text-muted-foreground">{t('price.note')}</label>
        <input name="note" type="text" className={input} />
      </div>

      <div className="sm:col-span-2 lg:col-span-4">
        {state?.error ? <p className="mb-2 text-sm font-medium text-danger">{t('err.invalid')}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {t('price.add')}
        </button>
      </div>
    </form>
  );
}
