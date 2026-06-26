'use client';

import { useEffect, useState } from 'react';
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
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

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

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-grove/55" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 start-0 flex w-80 max-w-[88vw] flex-col bg-card shadow-xl shadow-roast/20">
            <div className="flex items-center justify-between border-b border-border/80 px-4 py-4">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Coffee className="size-4" />
                </div>
                <span className="text-sm font-bold text-roast">{title}</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-linen/45 hover:text-roast"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <NavLinks groups={groups} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
