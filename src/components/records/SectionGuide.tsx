import { ChevronDown, Info } from 'lucide-react';

/**
 * Collapsible "How to use this section" guide shown at the top of a data
 * management section (BRD §16–17). Native <details> so it needs no client JS
 * and works in RTL. `points` is a list of short guidance lines; pass the
 * localized array via `t.raw('guide.<section>.points')`.
 */
export function SectionGuide({ title, intro, points }: { title: string; intro?: string; points: string[] }) {
  return (
    <details className="group rounded-[var(--radius)] border bg-card/70 shadow-sm [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-semibold text-foreground">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Info className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground group-open:rotate-180" />
      </summary>
      <div className="space-y-2 border-t px-4 py-3 text-sm leading-6 text-muted-foreground">
        {intro ? <p className="max-w-4xl">{intro}</p> : null}
        {points.length ? (
          <ul className="grid gap-1 ps-0 sm:grid-cols-2">
            {points.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
