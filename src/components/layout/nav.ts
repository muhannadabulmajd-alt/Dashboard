import { getTranslations } from 'next-intl/server';
import type { Role } from '@prisma/client';
import { NAV_ITEMS, NAV_GROUPS, can } from '@/lib/rbac';
import type { NavGroup } from './NavLinks';

/**
 * Role-visible navigation, grouped + translated, with empty groups dropped.
 * Shared by the desktop sidebar and the mobile drawer so both stay in sync.
 */
export async function getNavGroups(role: Role): Promise<NavGroup[]> {
  const t = await getTranslations('nav');
  const visible = NAV_ITEMS.filter((i) => can(role, i.capability));
  return NAV_GROUPS.map((g) => ({
    key: g.key,
    label: t(`group.${g.key}`),
    defaultOpen: g.defaultOpen,
    items: visible
      .filter((i) => i.group === g.key)
      .map((i) => ({ href: i.href, icon: i.icon, label: t(i.key) })),
  })).filter((g) => g.items.length > 0);
}
