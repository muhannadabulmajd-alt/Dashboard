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

export function FilterBar({ branchOptions }: { branchOptions?: Option[] }) {
  const t = useTranslations('filters');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const current = (key: string): string[] => {
    const v = searchParams.get(key);
    return v ? v.split(',').filter(Boolean) : [];
  };
  const range = searchParams.get('range') ?? 'this_month';

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

  const groups: { key: string; label: string; options: Option[] }[] = [
    ...ENUM_GROUPS.map((g) => ({
      key: g.key,
      label: t(g.labelKey),
      options: g.options.map((o) => ({ value: o, label: enumLabel(o, locale) })),
    })),
    ...(branchOptions && branchOptions.length
      ? [{ key: 'branchId', label: t('branch'), options: branchOptions }]
      : []),
  ];

  const anyActive = groups.some((g) => current(g.key).length > 0);

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
        onChange={(e) => apply((sp) => sp.set('range', e.target.value))}
        className="rounded-lg border bg-card px-2.5 py-1.5 text-sm"
      >
        {RANGE_PRESETS.filter((p) => p !== 'custom').map((p) => (
          <option key={p} value={p}>
            {t(`presets.${p}`)}
          </option>
        ))}
      </select>

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
