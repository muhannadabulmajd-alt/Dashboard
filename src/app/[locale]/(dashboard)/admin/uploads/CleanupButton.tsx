'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { cleanupDuplicateFinanceImports } from './actions';

export function CleanupButton({ label, confirmText }: { label: string; confirmText: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(confirmText)) return;
        start(async () => {
          await cleanupDuplicateFinanceImports();
          router.refresh();
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger-soft px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      {label}
    </button>
  );
}
