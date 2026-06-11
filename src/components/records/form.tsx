'use client';

import { useActionState, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { ActionState } from '@/server/records/shared';

/** Show a field only while another field holds one of these values. */
type ShowWhen = { field: string; in: string[] };

export type FieldDef =
  | { name: string; label: string; type: 'text' | 'number' | 'email' | 'date'; required?: boolean; placeholder?: string; step?: string; hint?: string; showWhen?: ShowWhen; disabled?: boolean }
  | { name: string; label: string; type: 'select'; required?: boolean; options: { value: string; label: string }[]; hint?: string; showWhen?: ShowWhen; disabled?: boolean }
  | { name: string; label: string; type: 'checkbox'; hint?: string; showWhen?: ShowWhen; disabled?: boolean };

const input =
  'min-h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-roast outline-none focus:border-primary focus:bg-card';
const disabledInput = 'cursor-not-allowed bg-muted/70 text-muted-foreground';

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
  note,
}: {
  action: Action;
  fields: FieldDef[];
  initial?: Record<string, string | number | boolean | null | undefined>;
  locale: string;
  submitLabel: string;
  cancelHref: string;
  cancelLabel: string;
  errors: Record<string, string>;
  /** Optional change-impact callout shown above the fields (BRD §22). */
  note?: string;
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
    <form action={formAction} className="grid gap-4 rounded-[var(--radius)] border border-border/80 bg-card p-4 shadow-[0_1px_0_rgba(83,45,31,0.05)] sm:grid-cols-2">
      <input type="hidden" name="locale" value={locale} />
      {note ? (
        <p className="rounded-lg border border-amber/25 bg-amber/10 px-3 py-2 text-xs leading-5 text-roast sm:col-span-2">{note}</p>
      ) : null}
      {fields.map((f) => {
        if (f.showWhen && !f.showWhen.in.includes(values[f.showWhen.field] ?? '')) return null;
        const v = initial?.[f.name];
        const dv = v === null || v === undefined ? '' : String(v);
        const track = watched.has(f.name)
          ? (val: string) => setValues((p) => ({ ...p, [f.name]: val }))
          : undefined;
        if (f.type === 'checkbox') {
          const checked = v === true || v === 'true' || v === 'on' || v === 1;
          const hintId = `${f.name}-hint`;
          return (
            <label key={f.name} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/80 bg-background/60 p-3 hover:bg-linen/35 sm:col-span-2">
              <input
                type="checkbox"
                name={f.name}
                defaultChecked={checked}
                disabled={f.disabled}
                aria-describedby={f.hint ? hintId : undefined}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="block text-sm font-medium text-foreground">{f.label}</span>
                {f.hint ? <span id={hintId} className="block text-xs leading-5 text-muted-foreground">{f.hint}</span> : null}
              </span>
            </label>
          );
        }
        const fieldId = `${f.name}-field`;
        const hintId = `${f.name}-hint`;
        return (
          <div key={f.name} className="flex flex-col gap-1">
            <label htmlFor={fieldId} className="text-xs font-semibold text-muted-foreground">
              {f.label}
              {f.required ? <span className="text-danger"> *</span> : null}
            </label>
            {f.type === 'select' ? (
              <select
                id={fieldId}
                name={f.name}
                defaultValue={dv}
                required={f.required}
                disabled={f.disabled}
                onChange={track ? (e) => track(e.target.value) : undefined}
                aria-describedby={f.hint ? hintId : undefined}
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
                id={fieldId}
                name={f.name}
                type={f.type}
                defaultValue={dv}
                required={f.required}
                disabled={f.disabled}
                placeholder={'placeholder' in f ? f.placeholder : undefined}
                step={'step' in f ? f.step : undefined}
                onChange={track ? (e) => track(e.target.value) : undefined}
                aria-describedby={f.hint ? hintId : undefined}
                className={cn(input, f.disabled && disabledInput)}
              />
            )}
            {/* Disabled controls don't submit; carry their (immutable) value so
                validation still passes. The server is the source of truth and
                ignores changes to immutable keys regardless. */}
            {f.disabled ? <input type="hidden" name={f.name} value={dv} /> : null}
            {f.hint ? <p id={hintId} className="text-xs leading-5 text-muted-foreground">{f.hint}</p> : null}
          </div>
        );
      })}

      {state?.error ? (
        <p role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger sm:col-span-2">
          {errors[state.error] ?? state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-border/80 pt-3 sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_1px_0_rgba(83,45,31,0.16)] hover:bg-amber/90 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {submitLabel}
        </button>
        <Link href={cancelHref} className="inline-flex min-h-10 items-center rounded-lg border border-border/80 bg-card px-4 py-2 text-sm font-semibold text-roast hover:bg-linen/45">
          {cancelLabel}
        </Link>
      </div>
    </form>
  );
}
