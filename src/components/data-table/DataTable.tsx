import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';

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
}: {
  columns: Column[];
  rows: React.ReactNode[][];
  exportHref?: string;
  exportLabel?: string;
  emptyLabel?: string;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border bg-card">
      {exportHref ? (
        <div className="flex justify-end border-b bg-muted/40 p-2">
          <a
            href={exportHref}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
          >
            <Download className="size-3.5" />
            {exportLabel}
          </a>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-muted-foreground">
              {columns.map((c, i) => (
                <th
                  key={i}
                  className={cn(
                    'whitespace-nowrap px-3 py-2 text-xs font-medium',
                    c.align === 'end' ? 'text-end' : 'text-start',
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              rows.map((row, ri) => (
                <tr key={ri} className="border-b last:border-0 hover:bg-muted/20">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        'whitespace-nowrap px-3 py-2',
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
