import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPercent, type AppLocale } from '@/lib/money';

export interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  delta?: number; // ratio, e.g. 0.12 == +12%
  locale: AppLocale;
  /** When true, a negative delta is "good" (e.g. cash burn, returns). */
  invertDelta?: boolean;
}

export function KpiCard({ label, value, sub, delta, locale, invertDelta }: KpiCardProps) {
  const hasDelta = delta !== undefined && Number.isFinite(delta);
  const good = hasDelta ? (invertDelta ? delta! < 0 : delta! > 0) : null;
  const flat = hasDelta && Math.abs(delta!) < 0.0005;

  return (
    <div className="rounded-[var(--radius)] border bg-card p-4 shadow-sm">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular text-foreground">{value}</div>
      <div className="mt-1 flex items-center gap-1 text-xs">
        {hasDelta ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-medium',
              flat ? 'text-muted-foreground' : good ? 'text-success' : 'text-danger',
            )}
          >
            {flat ? (
              <Minus className="size-3" />
            ) : delta! > 0 ? (
              <ArrowUpRight className="size-3" />
            ) : (
              <ArrowDownRight className="size-3" />
            )}
            {formatPercent(Math.abs(delta!), locale, 1)}
          </span>
        ) : null}
        {sub ? <span className="text-muted-foreground">{sub}</span> : null}
      </div>
    </div>
  );
}
