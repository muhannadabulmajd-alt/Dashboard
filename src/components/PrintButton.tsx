'use client';

import { Printer } from 'lucide-react';

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
    >
      <Printer className="size-4" />
      {label}
    </button>
  );
}
