'use client';

import { useActionState, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { ActionState } from '@/server/records/shared';

/** Show a field only while another field holds one of these values. */
type ShowWhen = { field: string; in: string[] };

export type FieldDef =
  | { name: string; label: string; type: 'text' | 'number' | 'email' | 'date'; required?: boolean; placeholder?: string; step?: string; showWhen?: ShowWhen; disabled?: boolean }
  | { name: string; label: string; type: 'select'; required?: boolean; options: { value: string; label: string }[]; showWhen?: ShowWhen; disabled?: boolean };

const input =
  'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';
const disabledInput = 'cursor-not-allowed bg-muted text-muted-foreground';

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Generic create/edit form. Pass a field schema + a server action; `initial`
 * pre-fills values for editing. Errors are surfaced from the action state.
 */
export function RecordForm({
  action,
  fields,
  initial,
  locale,
  submitLabel,
  cancelHref,
  cancelLabel,
  errors,
}: {
  action: Action;
  fields: FieldDef[];
  initial?: Record<string, string | number | null | undefined>;
  locale: string;
  submitLabel: string;
  cancelHref: string;
  cancelLabel: string;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);

  // Fields may declare `showWhen` to appear only for certain values of another
  // field (e.g. the FX rate only matters when the currency is USD). Track the
  // live value of any referenced field so visibility updates as the user edits.
  const watched = new Set(
    fields.map((f) => f.showWhen?.field).filter((n): n is string => Boolean(n)),
  );
  const [values, setValues] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const f of fields) {
      const raw = initial?.[f.name];
      let val = raw === null || raw === undefined ? '' : String(raw);
      // A required select with no initial value renders its first option.
      if (!val && f.type === 'select' && f.required && f.options.length) val = f.options[0].value;
      o[f.name] = val;
    }
    return o;
  });

  return (
    <form action={formAction} className="grid gap-3 rounded-[var(--radius)] border bg-card p-4 sm:grid-cols-2">
      <input type="hidden" name="locale" value={locale} />
      {fields.map((f) => {
        if (f.showWhen && !f.showWhen.in.includes(values[f.showWhen.field] ?? '')) return null;
        const v = initial?.[f.name];
        const dv = v === null || v === undefined ? '' : String(v);
        const track = watched.has(f.name)
          ? (val: string) => setValues((p) => ({ ...p, [f.name]: val }))
          : undefined;
        return (
          <div key={f.name} className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              {f.label}
              {f.required ? <span className="text-danger"> *</span> : null}
            </label>
            {f.type === 'select' ? (
              <select
                name={f.name}
                defaultValue={dv}
                required={f.required}
                disabled={f.disabled}
                onChange={track ? (e) => track(e.target.value) : undefined}
                className={cn(input, f.disabled && disabledInput)}
              >
                {!f.required ? <option value="">—</option> : null}
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={f.name}
                type={f.type}
                defaultValue={dv}
                required={f.required}
                disabled={f.disabled}
                placeholder={'placeholder' in f ? f.placeholder : undefined}
                step={'step' in f ? f.step : undefined}
                onChange={track ? (e) => track(e.target.value) : undefined}
                className={cn(input, f.disabled && disabledInput)}
              />
            )}
            {/* Disabled controls don't submit; carry their (immutable) value so
                validation still passes. The server is the source of truth and
                ignores changes to immutable keys regardless. */}
            {f.disabled ? <input type="hidden" name={f.name} value={dv} /> : null}
          </div>
        );
      })}

      {state?.error ? (
        <p className="text-sm font-medium text-danger sm:col-span-2">
          {errors[state.error] ?? state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {submitLabel}
        </button>
        <Link href={cancelHref} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted">
          {cancelLabel}
        </Link>
      </div>
    </form>
  );
}
