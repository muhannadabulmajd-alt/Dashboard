'use client';

import { useActionState } from 'react';
import { Loader2, PackagePlus } from 'lucide-react';
import type { ActionState } from '@/server/records/shared';

export function InventoryBootstrapPanel({
  action,
  locale,
  idempotencyKey,
  readiness,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  idempotencyKey: string;
  readiness: {
    centralLocation: { nameEn: string; nameAr: string; stockVersion: number } | null;
    centralLocationCount: number;
    missingDefinitionCount: number;
    missingPolicyCount: number;
    conflicts: string[];
  };
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const workCount = readiness.missingDefinitionCount + readiness.missingPolicyCount;
  const blocked = !readiness.centralLocation || readiness.conflicts.length > 0;
  return (
    <section className="mb-5 space-y-3 rounded-[var(--radius)] border bg-card p-4">
      <div>
        <h2 className="text-base font-semibold">{labels.title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{labels.hint}</p>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">{labels.central}</dt><dd className="font-semibold">{readiness.centralLocation ? (locale === 'ar' ? readiness.centralLocation.nameAr : readiness.centralLocation.nameEn) : labels.notConfigured}</dd></div>
        <div><dt className="text-muted-foreground">{labels.missingDefinitions}</dt><dd className="font-semibold tabular-nums">{readiness.missingDefinitionCount}</dd></div>
        <div><dt className="text-muted-foreground">{labels.missingPolicies}</dt><dd className="font-semibold tabular-nums">{readiness.missingPolicyCount}</dd></div>
      </dl>
      {readiness.conflicts.length ? (
        <p className="rounded-lg border border-danger/20 bg-danger-soft p-3 text-sm text-danger">
          {labels.conflicts}: {readiness.conflicts.join(', ')}
        </p>
      ) : null}
      {readiness.centralLocationCount !== 1 ? (
        <p className="rounded-lg border border-warning/25 bg-warning-soft p-3 text-sm text-warning">{labels.centralRequired}</p>
      ) : null}
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="expectedCentralLocationVersion" value={readiness.centralLocation?.stockVersion ?? ''} />
        <button
          type="submit"
          disabled={pending || blocked || workCount === 0}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
          {labels.run}
        </button>
        {workCount === 0 && !blocked ? <span className="text-sm font-semibold text-success">{labels.ready}</span> : null}
        {state?.ok ? <span className="text-sm font-semibold text-success">{labels.done}</span> : null}
        {state?.error ? <span role="alert" className="text-sm font-semibold text-danger">{errors[state.error] ?? state.error}</span> : null}
      </form>
    </section>
  );
}
