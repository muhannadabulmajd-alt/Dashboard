import { ArrowLeft, Filter, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';

export function DrilldownBanner({
  title,
  description,
  chips,
  totalLabel,
  totalValue,
  rowsLabel,
  rowsValue,
  backHref,
  backLabel,
  clearHref,
  clearLabel,
}: {
  title: string;
  description?: string;
  chips: string[];
  totalLabel: string;
  totalValue: string;
  rowsLabel: string;
  rowsValue: string | number;
  backHref: string;
  backLabel: string;
  clearHref: string;
  clearLabel: string;
}) {
  return (
    <section className="rounded-[var(--radius)] border border-amber/25 bg-linen/25 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-primary">
            <Filter className="size-3.5" />
            {title}
          </div>
          {description ? <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={backHref} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-semibold text-roast hover:bg-linen/45">
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {backLabel}
          </Link>
          <Link href={clearHref} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-danger/20 bg-danger-soft/60 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger-soft">
            <X className="size-3.5" />
            {clearLabel}
          </Link>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span key={chip} className="rounded-full border border-border/80 bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            {chip}
          </span>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border bg-card px-3 py-2">
          <div className="text-xs font-semibold text-muted-foreground">{totalLabel}</div>
          <div className="mt-1 break-words text-xl font-bold leading-tight text-roast">{totalValue}</div>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2">
          <div className="text-xs font-semibold text-muted-foreground">{rowsLabel}</div>
          <div className="mt-1 text-xl font-bold leading-tight text-roast">{rowsValue}</div>
        </div>
      </div>
    </section>
  );
}
