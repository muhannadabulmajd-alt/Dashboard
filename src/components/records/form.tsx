'use client';

import { useActionState } from 'react';
import { Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { ActionState } from '@/server/records/shared';

export type FieldDef =
  | { name: string; label: string; type: 'text' | 'number' | 'email' | 'date'; required?: boolean; placeholder?: string; step?: string }
  | { name: string; label: string; type: 'select'; required?: boolean; options: { value: string; label: string }[] };

const input =
  'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

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

  return (
    <form action={formAction} className="grid gap-3 rounded-[var(--radius)] border bg-card p-4 sm:grid-cols-2">
      <input type="hidden" name="locale" value={locale} />
      {fields.map((f) => {
        const v = initial?.[f.name];
        const dv = v === null || v === undefined ? '' : String(v);
        return (
          <div key={f.name} className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              {f.label}
              {f.required ? <span className="text-danger"> *</span> : null}
            </label>
            {f.type === 'select' ? (
              <select name={f.name} defaultValue={dv} required={f.required} className={input}>
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
                placeholder={'placeholder' in f ? f.placeholder : undefined}
                step={'step' in f ? f.step : undefined}
                className={input}
              />
            )}
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
