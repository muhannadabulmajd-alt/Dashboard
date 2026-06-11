'use client';

import { useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { RANGE_PRESETS } from '@/lib/filters';
import { CHANNELS, GOVERNORATES, PRODUCT_LINES, GRINDS, enumLabel } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import { cn } from '@/lib/utils';

const ENUM_GROUPS = [
  { key: 'channel', labelKey: 'channel', options: CHANNELS },
  { key: 'governorate', labelKey: 'city', options: GOVERNORATES },
  { key: 'productLine', labelKey: 'productLine', options: PRODUCT_LINES },
  { key: 'grind', labelKey: 'grind', options: GRINDS },
] as const;

interface Option {
  value: string;
  label: string;
}

// Which filters each page actually uses. Pages not listed (finance, admin,
// records, …) get no filter bar at all, so no page shows irrelevant filters.
type FilterConfig = { groups: string[]; branch: boolean };
const ALL_GROUPS = ['channel', 'governorate', 'productLine', 'grind'];
function pageConfig(path: string): FilterConfig | null {
  if (path.startsWith('/finance/reports/product-profitability')) {
    return { groups: ['channel', 'productLine', 'grind'], branch: true };
  }
  if (path.startsWith('/finance/reports/branch-profitability')) {
    return { groups: ['channel'], branch: false };
  }
  if (path.startsWith('/finance/reports')) return { groups: [], branch: true };
  if (path.startsWith('/finance') || path.startsWith('/admin')) return null;
  const map: Record<string, FilterConfig> = {
    '/': { groups: ALL_GROUPS, branch: true },
    '/sales': { groups: ALL_GROUPS, branch: true },
    '/inventory': { groups: [], branch: true },
    '/pnl': { groups: ['channel'], branch: true },
    '/roastery': { groups: [], branch: true },
    '/customers': { groups: ['channel', 'governorate'], branch: true },
    '/fulfillment': { groups: ['channel', 'governorate'], branch: true },
    '/offers': { groups: ['channel'], branch: true },
    '/compare': { groups: [], branch: true },
    '/franchise': { groups: [], branch: true },
  };
  return map[path] ?? { groups: ALL_GROUPS, branch: true };
}

export function FilterBar({
  branchOptions,
  listOptions,
}: {
  branchOptions?: Option[];
  /** Managed system-list options (§9) keyed by filter group; overrides the
   * static enum lists so relabels and user-added values apply. */
  listOptions?: Partial<Record<'channel' | 'governorate' | 'productLine' | 'grind', Option[]>>;
}) {
  const t = useTranslations('filters');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const cfg = pageConfig(pathname);

  const current = (key: string): string[] => {
    const v = searchParams.get(key);
    return v ? v.split(',').filter(Boolean) : [];
  };
  const range = searchParams.get('range') ?? 'all';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';

  const apply = (mutate: (sp: URLSearchParams) => void) => {
    const sp = new URLSearchParams(searchParams.toString());
    mutate(sp);
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`));
  };

  const toggle = (key: string, value: string) =>
    apply((sp) => {
      const set = new Set(current(key));
      if (set.has(value)) set.delete(value);
      else set.add(value);
      const arr = [...set];
      if (arr.length) sp.set(key, arr.join(','));
      else sp.delete(key);
    });

  const groups: { key: string; label: string; options: Option[] }[] = cfg
    ? [
        ...ENUM_GROUPS.filter((g) => cfg.groups.includes(g.key)).map((g) => ({
          key: g.key,
          label: t(g.labelKey),
          options: listOptions?.[g.key] ?? g.options.map((o) => ({ value: o, label: enumLabel(o, locale) })),
        })),
        ...(cfg.branch && branchOptions && branchOptions.length
          ? [{ key: 'branchId', label: t('branch'), options: branchOptions }]
          : []),
      ]
    : [];

  const anyActive = groups.some((g) => current(g.key).length > 0);

  // Pages without a config (finance, admin, records, …) show no filter bar.
  if (!cfg) return null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2.5 transition-opacity',
        pending && 'opacity-60',
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <SlidersHorizontal className="size-4" />
        {t('title')}
      </span>

      <select
        aria-label={t('dateRange')}
        value={range}
        onChange={(e) =>
          apply((sp) => {
            const v = e.target.value;
            sp.set('range', v);
            if (v !== 'custom') {
              sp.delete('from');
              sp.delete('to');
            }
          })
        }
        className="rounded-lg border bg-card px-2.5 py-1.5 text-sm"
      >
        {RANGE_PRESETS.map((p) => (
          <option key={p} value={p}>
            {t(`presets.${p}`)}
          </option>
        ))}
      </select>

      {range === 'custom' ? (
        <span className="flex items-center gap-1">
          <input
            type="date"
            aria-label={t('from')}
            value={from}
            max={to || undefined}
            onChange={(e) =>
              apply((sp) => (e.target.value ? sp.set('from', e.target.value) : sp.delete('from')))
            }
            className="rounded-lg border bg-card px-2 py-1.5 text-sm"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            aria-label={t('to')}
            value={to}
            min={from || undefined}
            onChange={(e) =>
              apply((sp) => (e.target.value ? sp.set('to', e.target.value) : sp.delete('to')))
            }
            className="rounded-lg border bg-card px-2 py-1.5 text-sm"
          />
        </span>
      ) : null}

      {groups.map((g) => (
        <MultiSelect
          key={g.key}
          label={g.label}
          options={g.options}
          selected={current(g.key)}
          onToggle={(v) => toggle(g.key, v)}
        />
      ))}

      {anyActive ? (
        <button
          onClick={() => startTransition(() => router.replace(pathname))}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:text-danger"
        >
          <X className="size-3.5" />
          {tc('reset')}
        </button>
      ) : null}
    </div>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-sm [&::-webkit-details-marker]:hidden">
        {label}
        {selected.length > 0 ? (
          <span className="rounded-full bg-primary/10 px-1.5 text-xs font-medium text-primary">
            {selected.length}
          </span>
        ) : null}
        <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute z-20 mt-1 max-h-64 w-52 overflow-auto rounded-lg border bg-card p-1 shadow-lg">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          >
            <input
              type="checkbox"
              className="accent-[var(--color-primary)]"
              checked={selected.includes(o.value)}
              onChange={() => onToggle(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </details>
  );
}
