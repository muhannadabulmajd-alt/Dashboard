'use client';

import { useEffect } from 'react';
import { Printer, ArrowLeft } from 'lucide-react';

export function InvoiceToolbar({
  backHref,
  printLabel,
  backLabel,
  autoPrint,
}: {
  backHref: string;
  printLabel: string;
  backLabel: string;
  autoPrint?: boolean;
}) {
  useEffect(() => {
    if (autoPrint) {
      const id = setTimeout(() => window.print(), 400);
      return () => clearTimeout(id);
    }
  }, [autoPrint]);
  return (
    <div className="mx-auto flex max-w-[820px] items-center justify-between px-4 py-3 print:hidden">
      <a href={backHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {backLabel}
      </a>
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
      >
        <Printer className="size-4" />
        {printLabel}
      </button>
    </div>
  );
}
