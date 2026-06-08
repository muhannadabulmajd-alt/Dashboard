import { Coffee } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { NavLinks, type NavGroup } from './NavLinks';

export async function Sidebar({ groups }: { groups: NavGroup[] }) {
  const tApp = await getTranslations('app');

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-e bg-card md:flex">
      <div className="flex items-center gap-2 border-b px-4 py-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Coffee className="size-5" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold">{tApp('short')}</div>
          <div className="text-[11px] text-muted-foreground">{tApp('tagline')}</div>
        </div>
      </div>
      <div className="p-3">
        <NavLinks groups={groups} />
      </div>
    </aside>
  );
}
