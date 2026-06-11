import { Coffee } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { NavLinks, type NavGroup } from './NavLinks';

export async function Sidebar({ groups }: { groups: NavGroup[] }) {
  const tApp = await getTranslations('app');

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-e border-grove/15 bg-grove text-primary-foreground md:flex">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-amber text-primary-foreground shadow-[0_1px_0_rgba(255,255,255,0.12)]">
          <Coffee className="size-5" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold">{tApp('short')}</div>
          <div className="text-[11px] text-primary-foreground/60">{tApp('tagline')}</div>
        </div>
      </div>
      <div className="p-3">
        <NavLinks groups={groups} tone="dark" />
      </div>
    </aside>
  );
}
