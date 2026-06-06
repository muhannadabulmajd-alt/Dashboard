import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/** A localized "← back" link used on record detail pages. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4 rtl:rotate-180" />
      {label}
    </Link>
  );
}

export interface DetailField {
  label: string;
  value: React.ReactNode;
}

/** Definition grid for a single record's fields. */
export function DetailGrid({ items, className }: { items: DetailField[]; className?: string }) {
  return (
    <dl className={cn('grid gap-px overflow-hidden rounded-[var(--radius)] border bg-border sm:grid-cols-2', className)}>
      {items.map((f, i) => (
        <div key={i} className="bg-card px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">{f.label}</dt>
          <dd className="mt-0.5 text-sm font-medium text-foreground">{f.value === '' || f.value == null ? '—' : f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
