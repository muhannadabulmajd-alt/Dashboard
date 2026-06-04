import { Coffee } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { Role } from '@prisma/client';
import { NAV_ITEMS, can } from '@/lib/rbac';
import { NavLinks } from './NavLinks';

export async function Sidebar({ role }: { role: Role }) {
  const t = await getTranslations('nav');
  const tApp = await getTranslations('app');

  const items = NAV_ITEMS.filter((i) => can(role, i.capability)).map((i) => ({
    href: i.href,
    icon: i.icon,
    label: t(i.key),
  }));

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
        <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('section')}
        </div>
        <NavLinks items={items} />
      </div>
    </aside>
  );
}
