'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Building2,
  Boxes,
  PackagePlus,
  Plus,
  ReceiptText,
  ShoppingBag,
  Sparkles,
  UserRoundPlus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { QuickAddItem } from './quick-add';

const ICONS: Record<string, LucideIcon> = {
  Building2,
  Boxes,
  PackagePlus,
  ReceiptText,
  ShoppingBag,
  Sparkles,
  UserRoundPlus,
};

export function GlobalQuickAdd({
  items,
  title,
  subtitle,
  buttonLabel,
  closeLabel,
}: {
  items: QuickAddItem[];
  title: string;
  subtitle: string;
  buttonLabel: string;
  closeLabel: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, [open]);

  if (items.length === 0) return null;

  const sheet = (
    <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label={closeLabel}
        className="absolute inset-0 bg-grove/45 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
      />
      <section className="absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] max-h-[min(42rem,calc(100dvh-2rem))] overflow-hidden rounded-lg border border-border bg-card shadow-2xl shadow-roast/25 sm:inset-x-auto sm:end-5 sm:w-[24rem]">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-roast">{title}</h2>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={closeLabel}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-linen/55 hover:text-roast"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="grid max-h-[calc(100dvh-9rem)] grid-cols-1 gap-2 overflow-y-auto p-3 sm:grid-cols-2">
          {items.map((item) => {
            const Icon = ICONS[item.icon] ?? Plus;
            return (
              <Link
                key={item.key}
                href={item.href}
                onClick={() => setOpen(false)}
                className="group flex min-h-20 items-start gap-3 rounded-lg border border-border bg-linen/20 p-3 text-start transition-colors hover:border-amber/45 hover:bg-linen/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-grove text-primary-foreground transition-colors group-hover:bg-amber">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-roast">{item.label}</span>
                  <span className="mt-1 block text-xs leading-4 text-muted-foreground">{item.description}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={buttonLabel}
        title={buttonLabel}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] end-4 z-50 inline-flex size-14 items-center justify-center rounded-full border border-white/20 bg-amber text-primary-foreground shadow-[0_12px_32px_rgba(83,45,31,0.28)] transition-transform hover:scale-[1.04] hover:bg-amber/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 sm:end-5"
      >
        <Plus className="size-6" strokeWidth={2.4} />
      </button>
      {open && typeof document !== 'undefined' ? createPortal(sheet, document.body) : null}
    </>
  );
}
