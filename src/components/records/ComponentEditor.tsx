'use client';

import { useActionState, useMemo, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { ActionState } from '@/server/records/shared';

const input = 'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';
export type ComponentRow = { name: string; quantity: string; unitCost: string };
const empty: ComponentRow = { name: '', quantity: '1', unitCost: '0' };

/** Cost-recipe (BOM) editor: components × unit cost → recomputed variation cost. */
export function ComponentEditor({
  action,
  locale,
  initial,
  labels,
  errors,
  cancelHref,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  locale: string;
  initial: ComponentRow[];
  labels: Record<string, string>;
  errors: Record<string, string>;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [rows, setRows] = useState<ComponentRow[]>(initial.length ? initial : [{ ...empty }]);
  const set = (i: number, k: keyof ComponentRow, v: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  const total = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unitCost) || 0), 0),
    [rows],
  );
  const fmt = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-IQ' : 'en-US').format(n);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="components" value={JSON.stringify(rows)} />

      <div className="rounded-[var(--radius)] border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{labels.components}</h3>
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, { ...empty }])}
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-muted"
          >
            <Plus className="size-3.5" />
            {labels.add}
          </button>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[2fr_1fr_1fr_auto] items-end gap-2">
              <div className="flex flex-col gap-1">
                {i === 0 ? <label className="text-xs text-muted-foreground">{labels.name}</label> : null}
                <input value={r.name} onChange={(e) => set(i, 'name', e.target.value)} className={input} />
              </div>
              <div className="flex flex-col gap-1">
                {i === 0 ? <label className="text-xs text-muted-foreground">{labels.quantity}</label> : null}
                <input type="number" value={r.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} className={input} />
              </div>
              <div className="flex flex-col gap-1">
                {i === 0 ? <label className="text-xs text-muted-foreground">{labels.unitCost}</label> : null}
                <input type="number" value={r.unitCost} onChange={(e) => set(i, 'unitCost', e.target.value)} className={input} />
              </div>
              <button
                type="button"
                onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs))}
                className="mb-1 rounded-lg border p-2 text-muted-foreground hover:bg-muted"
                aria-label={labels.remove}
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end border-t pt-3 text-sm">
          <span className="text-muted-foreground">
            {labels.total}: <span className="font-bold tabular-nums text-foreground">{fmt(total)}</span>
          </span>
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
          {labels.save}
        </button>
        <Link href={cancelHref} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted">
          {labels.cancel}
        </Link>
      </div>
    </form>
  );
}
