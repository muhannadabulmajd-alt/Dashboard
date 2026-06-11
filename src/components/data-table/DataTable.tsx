import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/primitives';

export interface Column {
  label: string;
  align?: 'start' | 'end';
}

export function DataTable({
  columns,
  rows,
  exportHref,
  exportLabel,
  emptyLabel,
  emptyTitle,
  emptyActionHref,
  emptyActionLabel,
  caption,
}: {
  columns: Column[];
  rows: React.ReactNode[][];
  exportHref?: string;
  exportLabel?: string;
  emptyLabel?: string;
  emptyTitle?: string;
  emptyActionHref?: string;
  emptyActionLabel?: string;
  caption?: string;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-border/80 bg-card shadow-[0_1px_0_rgba(83,45,31,0.05)]">
      {exportHref ? (
        <div className="flex justify-end border-b bg-linen/30 p-2">
          <a
            href={exportHref}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-amber/25 bg-card px-2.5 py-1 text-xs font-semibold text-roast hover:bg-linen/45"
          >
            <Download className="size-3.5" />
            {exportLabel ?? 'Export CSV'}
          </a>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b bg-linen/40 text-muted-foreground">
              {columns.map((c, i) => (
                <th
                  key={i}
                  className={cn(
                    'sticky top-0 z-10 whitespace-nowrap bg-linen/70 px-3 py-2.5 text-xs font-bold uppercase tracking-[0.08em]',
                    c.align === 'end' ? 'text-end' : 'text-start',
                  )}
                  scope="col"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-3">
                  <EmptyState
                    title={emptyTitle}
                    message={emptyLabel ?? 'No records match the current view.'}
                    actionHref={emptyActionHref}
                    actionLabel={emptyActionLabel}
                  />
                </td>
              </tr>
            ) : (
              rows.map((row, ri) => (
                <tr key={ri} className="border-b border-border/70 last:border-0 hover:bg-linen/20">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        'whitespace-nowrap px-3 py-2.5 align-middle',
                        columns[ci]?.align === 'end' ? 'text-end tabular' : 'text-start',
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
