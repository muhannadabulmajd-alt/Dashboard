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
    <div className="overflow-hidden rounded-[var(--radius)] border bg-card shadow-sm">
      {exportHref ? (
        <div className="flex justify-end border-b bg-muted/30 p-2">
          <a
            href={exportHref}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
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
            <tr className="border-b bg-muted/30 text-muted-foreground">
              {columns.map((c, i) => (
                <th
                  key={i}
                  className={cn(
                    'sticky top-0 z-10 whitespace-nowrap bg-muted/30 px-3 py-2.5 text-xs font-semibold',
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
                <tr key={ri} className="border-b last:border-0 hover:bg-muted/20">
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
