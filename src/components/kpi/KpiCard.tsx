import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
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
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'accent';
  icon?: LucideIcon;
  href?: string;
  description?: string;
  emphasis?: boolean;
}

const toneStyles: Record<NonNullable<KpiCardProps['tone']>, { icon: string; card: string }> = {
  default: { icon: 'bg-linen/70 text-roast', card: 'border-border/80 bg-card' },
  success: { icon: 'bg-success-soft text-success', card: 'border-success/25 bg-card' },
  warning: { icon: 'bg-warning-soft text-warning', card: 'border-warning/25 bg-card' },
  danger: { icon: 'bg-danger-soft text-danger', card: 'border-danger/25 bg-card' },
  accent: { icon: 'bg-amber/15 text-primary', card: 'border-amber/30 bg-card' },
};

export function KpiCard({
  label,
  value,
  sub,
  delta,
  locale,
  invertDelta,
  tone = 'default',
  icon: Icon,
  href,
  description,
  emphasis,
}: KpiCardProps) {
  const hasDelta = delta !== undefined && Number.isFinite(delta);
  const good = hasDelta ? (invertDelta ? delta! < 0 : delta! > 0) : null;
  const flat = hasDelta && Math.abs(delta!) < 0.0005;
  const style = toneStyles[tone];

  const body = (
    <div
      className={cn(
        'h-full min-h-32 rounded-[var(--radius)] border p-4 shadow-[0_1px_0_rgba(83,45,31,0.05)] transition-colors',
        style.card,
        href && 'hover:border-primary/45 hover:bg-linen/20',
        emphasis && 'bg-grove text-primary-foreground',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className={cn('max-w-full text-xs font-semibold leading-5', emphasis ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
            {label}
          </div>
          <div
            className={cn(
              'mt-1 max-w-full break-words text-[clamp(1.45rem,1.65vw,2rem)] font-bold leading-tight tracking-[-0.01em] tabular',
              emphasis ? 'text-primary-foreground' : 'text-roast',
            )}
            title={value}
          >
            {value}
          </div>
        </div>
        {Icon ? (
          <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', emphasis ? 'bg-white/10 text-primary-foreground' : style.icon)}>
            <Icon className="size-5" />
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex min-h-4 flex-wrap items-center gap-1 text-xs">
        {hasDelta ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-semibold',
              emphasis
                ? 'text-primary-foreground/80'
                : flat
                  ? 'text-muted-foreground'
                  : good
                    ? 'text-success'
                    : 'text-danger',
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
        {sub ? <span className={cn(emphasis ? 'text-primary-foreground/75' : 'text-muted-foreground')}>{sub}</span> : null}
        {description ? (
          <span className={cn('basis-full leading-5', emphasis ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
            {description}
          </span>
        ) : null}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}
