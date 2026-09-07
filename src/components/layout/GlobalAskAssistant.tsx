'use client';

import { Sparkles } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';

export function GlobalAskAssistant({ label }: { label: string }) {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === '/ai-assistant' || pathname.startsWith('/ai-assistant/')) return null;

  const openAssistant = () => {
    const currentPath = `${pathname}${window.location.search}`;
    router.push(`/ai-assistant?context=${encodeURIComponent(currentPath)}`);
  };

  return (
    <button
      type="button"
      onClick={openAssistant}
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] end-4 z-50 inline-flex min-h-11 max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg border border-white/20 bg-grove px-3.5 text-sm font-bold text-primary-foreground shadow-[0_10px_28px_rgba(43,55,24,0.24)] hover:bg-grove/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grove focus-visible:ring-offset-2 sm:end-5"
      aria-label={label}
      title={label}
    >
      <Sparkles className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
