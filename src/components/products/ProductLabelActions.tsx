'use client';

import { Download, Printer } from 'lucide-react';

export function ProductLabelActions({
  pdfHref,
  printLabel,
  downloadLabel,
}: {
  pdfHref: string;
  printLabel: string;
  downloadLabel: string;
}) {
  return (
    <>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 py-2 text-sm font-semibold text-roast hover:bg-linen/40 max-sm:w-full"
      >
        <Printer className="size-4" />
        {printLabel}
      </button>
      <a
        href={pdfHref}
        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-amber/90 max-sm:w-full"
      >
        <Download className="size-4" />
        {downloadLabel}
      </a>
    </>
  );
}
