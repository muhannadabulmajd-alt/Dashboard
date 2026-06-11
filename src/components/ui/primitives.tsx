import { cn } from '@/lib/utils';
import { Link } from '@/i18n/navigation';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('rounded-[var(--radius)] border bg-card shadow-sm', className)}>{children}</div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex items-center justify-between gap-2 p-4 pb-2', className)}>{children}</div>;
}

export function CardTitle({ children, className }: { className?: string; children: React.ReactNode }) {
  return <h3 className={cn('text-sm font-semibold text-foreground', className)}>{children}</h3>;
}

export function CardContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('p-4 pt-2', className)}>{children}</div>;
}

type BadgeVariant = 'default' | 'success' | 'danger' | 'warning' | 'muted';

const badgeStyles: Record<BadgeVariant, string> = {
  default: 'border-primary/20 bg-primary/10 text-primary',
  success: 'border-success/20 bg-success-soft text-success',
  danger: 'border-danger/20 bg-danger-soft text-danger',
  warning: 'border-warning/20 bg-warning-soft text-warning',
  muted: 'border-border bg-muted text-muted-foreground',
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
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
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
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed bg-muted/20 p-6 text-center">
      {title ? <p className="text-sm font-semibold text-foreground">{title}</p> : null}
      <p className="max-w-md text-sm leading-6 text-muted-foreground">{message}</p>
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="mt-1 inline-flex items-center rounded-lg border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
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
          ? 'bg-primary text-primary-foreground hover:opacity-95'
          : 'border bg-card text-foreground hover:bg-muted',
        className,
      )}
    >
      {children}
    </Link>
  );
}
