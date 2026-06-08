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
        <div key={s.label} className="rounded-xl border bg-card p-3 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground">{s.label}</div>
          <div className={cn('mt-1 text-xl font-bold tabular-nums', TONE[s.tone ?? 'default'])}>{s.value}</div>
        </div>
      ))}
    </section>
  );
}
