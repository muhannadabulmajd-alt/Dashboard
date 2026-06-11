import { cn } from '@/lib/utils';

export interface SummaryStat {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}

const TONE: Record<NonNullable<SummaryStat['tone']>, string> = {
  default: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

/** Compact stat strip for the otherwise table-only records pages. */
export function RecordsSummary({ stats }: { stats: SummaryStat[] }) {
  if (!stats.length) return null;
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((s) => (
        <div key={s.label} className="rounded-[var(--radius)] border border-border/80 bg-card p-3 shadow-[0_1px_0_rgba(83,45,31,0.05)]">
          <div className="text-xs font-semibold text-muted-foreground">{s.label}</div>
          <div className={cn('mt-1 text-xl font-bold tabular-nums', TONE[s.tone ?? 'default'])}>{s.value}</div>
        </div>
      ))}
    </section>
  );
}
