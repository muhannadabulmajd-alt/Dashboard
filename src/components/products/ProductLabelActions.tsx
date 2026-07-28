'use client';

import { Download, Printer } from 'lucide-react';
import { useState } from 'react';

export function ProductLabelActions({
  pdfHref,
  printLabel,
  downloadLabel,
  copiesLabel,
  copiesHint,
}: {
  pdfHref: string;
  printLabel: string;
  downloadLabel: string;
  copiesLabel: string;
  copiesHint: string;
}) {
  const [copies, setCopies] = useState(1);
  const pdfUrl = (disposition: 'inline' | 'attachment') => {
    const separator = pdfHref.includes('?') ? '&' : '?';
    return `${pdfHref}${separator}copies=${copies}&disposition=${disposition}`;
  };

  return (
    <div className="flex flex-wrap items-end gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
      <label className="flex min-w-28 flex-col gap-1 text-xs font-medium text-muted-foreground">
        {copiesLabel}
        <input
          aria-describedby="label-copies-hint"
          className="min-h-10 w-full rounded-lg border border-border bg-card px-3 text-base text-roast"
          max={24}
          min={1}
          onChange={(event) => setCopies(Math.min(24, Math.max(1, Number(event.target.value) || 1)))}
          type="number"
          value={copies}
        />
        <span id="label-copies-hint" className="sr-only">{copiesHint}</span>
      </label>
      <a
        href={pdfUrl('inline')}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 py-2 text-sm font-semibold text-roast hover:bg-linen/40"
      >
        <Printer className="size-4" />
        {printLabel}
      </a>
      <a
        href={pdfUrl('attachment')}
        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-amber/90"
      >
        <Download className="size-4" />
        {downloadLabel}
      </a>
    </div>
  );
}
