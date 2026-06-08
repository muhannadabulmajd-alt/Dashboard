import { Coffee } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { Role } from '@prisma/client';
import { NAV_ITEMS, NAV_GROUPS, can } from '@/lib/rbac';
import { NavLinks } from './NavLinks';

export async function Sidebar({ role }: { role: Role }) {
  const t = await getTranslations('nav');
  const tApp = await getTranslations('app');

  const visible = NAV_ITEMS.filter((i) => can(role, i.capability));
  // Group the role-visible items; drop any group the role can't see at all.
  const groups = NAV_GROUPS.map((g) => ({
    key: g.key,
    label: t(`group.${g.key}`),
    defaultOpen: g.defaultOpen,
    items: visible
      .filter((i) => i.group === g.key)
      .map((i) => ({ href: i.href, icon: i.icon, label: t(i.key) })),
  })).filter((g) => g.items.length > 0);

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
