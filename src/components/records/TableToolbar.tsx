'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';

type Opt = { value: string; label: string };
export type FilterDef = { name: string; label: string; options: Opt[] };

const control =
  'rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

/**
 * URL-driven search / filter / sort bar for the data-management tables (CR-9).
 * All state lives in the query string so it's shareable and server-rendered;
 * the search box is debounced. Selecting a filter/sort resets to page 1.
 */
export function TableToolbar({
  searchPlaceholder,
  filters = [],
  sorts = [],
  sortLabel,
}: {
  searchPlaceholder: string;
  filters?: FilterDef[];
  sorts?: Opt[];
  sortLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const apply = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    router.push(next.toString() ? `${pathname}?${next}` : pathname);
  };

  const [q, setQ] = useState(params.get('q') ?? '');
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => apply({ q }), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchPlaceholder}
          className={`w-full ${control} ps-9`}
        />
      </div>
      {filters.map((f) => (
        <select
          key={f.name}
          value={params.get(f.name) ?? ''}
          onChange={(e) => apply({ [f.name]: e.target.value })}
          className={control}
        >
          <option value="">{f.label}</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
      {sorts.length ? (
        <select value={params.get('sort') ?? ''} onChange={(e) => apply({ sort: e.target.value })} className={control}>
          <option value="">{sortLabel}</option>
          {sorts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
