import { cn } from '@/lib/utils';
import { Link } from '@/i18n/navigation';

type CardVariant = 'default' | 'surface' | 'accent' | 'success' | 'danger';

const cardVariants: Record<CardVariant, string> = {
  default: 'border-border/80 bg-card shadow-[0_1px_0_rgba(83,45,31,0.05)]',
  surface: 'border-border/70 bg-linen/35 shadow-none',
  accent: 'border-amber/25 bg-amber/10 shadow-none',
  success: 'border-success/25 bg-success-soft/80 shadow-none',
  danger: 'border-danger/25 bg-danger-soft/80 shadow-none',
};

export function Card({
  className,
  children,
  variant = 'default',
}: {
  className?: string;
  children: React.ReactNode;
  variant?: CardVariant;
}) {
  return (
    <div className={cn('rounded-[var(--radius)] border', cardVariants[variant], className)}>{children}</div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex items-center justify-between gap-3 p-4 pb-2', className)}>{children}</div>;
}

export function CardTitle({ children, className }: { className?: string; children: React.ReactNode }) {
  return <h3 className={cn('text-sm font-semibold tracking-tight text-foreground', className)}>{children}</h3>;
}

export function CardContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('p-4 pt-2', className)}>{children}</div>;
}

type BadgeVariant = 'default' | 'success' | 'danger' | 'warning' | 'muted';

const badgeStyles: Record<BadgeVariant, string> = {
  default: 'border-amber/25 bg-amber/10 text-roast',
  success: 'border-success/20 bg-success-soft text-success',
  danger: 'border-danger/20 bg-danger-soft text-danger',
  warning: 'border-warning/20 bg-warning-soft text-warning',
  muted: 'border-border bg-muted/70 text-muted-foreground',
};

export function Badge({
  variant = 'default',
  children,
  className,
}: {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        'border',
        badgeStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">{eyebrow}</div>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight text-roast">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  actionHref,
  actionLabel,
}: {
  title?: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-amber/25 bg-linen/25 p-6 text-center">
      {title ? <p className="text-sm font-semibold text-foreground">{title}</p> : null}
      <p className="max-w-md text-sm leading-6 text-muted-foreground">{message}</p>
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="mt-1 inline-flex items-center rounded-lg border border-amber/25 bg-card px-3 py-1.5 text-xs font-semibold text-roast hover:bg-linen/50"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function ActionLink({
  href,
  children,
  variant = 'primary',
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold',
        variant === 'primary'
          ? 'bg-primary text-primary-foreground shadow-[0_1px_0_rgba(83,45,31,0.18)] hover:bg-amber/90'
          : 'border border-border/80 bg-card text-roast hover:bg-linen/40',
        className,
      )}
    >
      {children}
    </Link>
  );
}
