'use client';

import { useActionState, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActionState } from '@/server/records/shared';

type PermissionKey =
  | 'canView'
  | 'canSell'
  | 'canReceive'
  | 'canCount'
  | 'canRecordExpense'
  | 'canProduce'
  | 'canDispatch'
  | 'canApprove';

type LocationAccess = Record<PermissionKey, boolean> & {
  locationId: string;
};

type LocationOption = {
  id: string;
  label: string;
  type: string;
  access?: LocationAccess;
};

const emptyAccess = (locationId: string): LocationAccess => ({
  locationId,
  canView: false,
  canSell: false,
  canReceive: false,
  canCount: false,
  canRecordExpense: false,
  canProduce: false,
  canDispatch: false,
  canApprove: false,
});

export function UserLocationAccessEditor({
  action,
  locale,
  locations,
  initialDefaultLocationId,
  labels,
  errors,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locale: string;
  locations: LocationOption[];
  initialDefaultLocationId: string;
  labels: Record<string, string>;
  errors: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [rows, setRows] = useState<LocationAccess[]>(() =>
    locations.map((location) => location.access ?? emptyAccess(location.id)),
  );
  const [defaultLocationId, setDefaultLocationId] = useState(initialDefaultLocationId);
  const viewableRows = useMemo(() => rows.filter((row) => row.canView), [rows]);

  const setPermission = (locationId: string, key: PermissionKey, checked: boolean) => {
    setRows((current) => current.map((row) => {
      if (row.locationId !== locationId) return row;
      if (key === 'canView' && !checked) {
        return emptyAccess(locationId);
      }
      return { ...row, [key]: checked, canView: key === 'canView' ? checked : checked || row.canView };
    }));
    if (key === 'canView' && !checked && defaultLocationId === locationId) {
      setDefaultLocationId('');
    }
  };

  return (
    <form action={formAction} className="mt-4 space-y-4 rounded-[var(--radius)] border bg-card p-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="accesses" value={JSON.stringify(viewableRows)} />
      <div>
        <h2 className="text-sm font-bold">{labels.title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{labels.hint}</p>
      </div>

      <label className="grid max-w-lg gap-1 text-xs font-semibold text-muted-foreground">
        {labels.defaultLocation}
        <select
          name="defaultLocationId"
          value={defaultLocationId}
          onChange={(event) => setDefaultLocationId(event.target.value)}
          className="min-h-10 rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="">—</option>
          {locations.filter((location) => rows.find((row) => row.locationId === location.id)?.canView).map((location) => (
            <option key={location.id} value={location.id}>{location.label}</option>
          ))}
        </select>
      </label>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-start">{labels.location}</th>
              {(['canView', 'canSell', 'canReceive', 'canCount', 'canRecordExpense', 'canProduce', 'canDispatch', 'canApprove'] as PermissionKey[]).map((key) => (
                <th key={key} className="px-2 py-2 text-center">{labels[key]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {locations.map((location) => {
              const row = rows.find((candidate) => candidate.locationId === location.id) ?? emptyAccess(location.id);
              return (
                <tr key={location.id} className="border-b last:border-0">
                  <td className="px-3 py-3">
                    <span className="block font-semibold">{location.label}</span>
                    <span className="text-xs text-muted-foreground">{location.type}</span>
                  </td>
                  {(['canView', 'canSell', 'canReceive', 'canCount', 'canRecordExpense', 'canProduce', 'canDispatch', 'canApprove'] as PermissionKey[]).map((key) => (
                    <td key={key} className="px-2 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={row[key]}
                        onChange={(event) => setPermission(location.id, key, event.target.checked)}
                        className="size-4 accent-primary"
                        aria-label={`${labels[key]}: ${location.label}`}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {state?.error ? (
        <p role="alert" className="rounded-lg border border-danger/20 bg-danger-soft p-3 text-sm font-semibold text-danger">
          {errors[state.error] ?? state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {labels.save}
      </button>
    </form>
  );
}
