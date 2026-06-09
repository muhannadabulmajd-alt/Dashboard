import { Info } from 'lucide-react';

/**
 * Collapsible "How to use this section" guide shown at the top of a data
 * management section (BRD §16–17). Native <details> so it needs no client JS
 * and works in RTL. `points` is a list of short guidance lines; pass the
 * localized array via `t.raw('guide.<section>.points')`.
 */
export function SectionGuide({ title, intro, points }: { title: string; intro?: string; points: string[] }) {
  return (
    <details className="rounded-[var(--radius)] border bg-primary/5 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-semibold text-foreground">
        <Info className="size-4 shrink-0 text-primary" />
        {title}
        <span className="ms-auto text-xs font-normal text-muted-foreground">▾</span>
      </summary>
      <div className="space-y-2 border-t border-primary/10 px-4 py-3 text-sm text-muted-foreground">
        {intro ? <p>{intro}</p> : null}
        {points.length ? (
          <ul className="list-disc space-y-1 ps-5">
            {points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
