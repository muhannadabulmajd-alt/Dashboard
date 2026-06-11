'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';

type Opt = { value: string; label: string };
export type FilterDef = { name: string; label: string; options: Opt[] };

const control =
  'min-h-10 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary';

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
  const t = useTranslations('common');

  const apply = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    router.push(next.toString() ? `${pathname}?${next}` : pathname);
  };
  const clearAll = () => {
    setQ('');
    const next = new URLSearchParams(params.toString());
    next.delete('q');
    next.delete('sort');
    next.delete('page');
    for (const f of filters) next.delete(f.name);
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

  const hasActiveFilters =
    q.length > 0 || Boolean(params.get('sort')) || filters.some((f) => Boolean(params.get(f.name)));

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border bg-card p-2 shadow-sm">
      <div className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchPlaceholder}
          className={`w-full ${control} ps-9`}
          aria-label={searchPlaceholder}
        />
      </div>
      {filters.map((f) => (
        <select
          key={f.name}
          value={params.get(f.name) ?? ''}
          onChange={(e) => apply({ [f.name]: e.target.value })}
          className={control}
          aria-label={f.label}
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
        <select
          value={params.get('sort') ?? ''}
          onChange={(e) => apply({ sort: e.target.value })}
          className={control}
          aria-label={sortLabel}
        >
          <option value="">{sortLabel}</option>
          {sorts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : null}
      {hasActiveFilters ? (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
          {t('clear')}
        </button>
      ) : null}
    </div>
  );
}
