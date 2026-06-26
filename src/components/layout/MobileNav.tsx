'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, X, Coffee } from 'lucide-react';
import { NavLinks, type NavGroup } from './NavLinks';

/** Hamburger + slide-in drawer that mirrors the desktop sidebar on small screens. */
export function MobileNav({ groups, title }: { groups: NavGroup[]; title: string }) {
  const [open, setOpen] = useState(false);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, [open]);

  const drawer = (
    <div className="fixed inset-0 z-[100] md:hidden" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close menu"
        className="absolute inset-0 bg-grove/55 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
      />
      <div className="fixed inset-y-0 start-0 flex h-screen h-dvh w-[min(22rem,92vw)] flex-col overflow-hidden rounded-e-2xl border-e border-border/80 bg-card shadow-2xl shadow-roast/25">
        <div className="flex items-center justify-between border-b border-border/80 bg-card px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_1px_0_rgba(83,45,31,0.18)]">
              <Coffee className="size-5" />
            </div>
            <span className="text-base font-bold text-roast">{title}</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="inline-flex size-10 items-center justify-center rounded-xl border border-border/70 bg-linen/35 text-muted-foreground hover:bg-linen/70 hover:text-roast"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks groups={groups} onNavigate={() => setOpen(false)} />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={title}
        className="inline-flex size-9 items-center justify-center rounded-lg border border-border/80 bg-card text-roast hover:bg-linen/45 md:hidden"
      >
        <Menu className="size-5" />
      </button>

      {open && typeof document !== 'undefined' ? createPortal(drawer, document.body) : null}
    </>
  );
}
