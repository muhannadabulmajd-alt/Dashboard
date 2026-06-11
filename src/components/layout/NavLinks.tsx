'use client';

import { useState } from 'react';
import {
  LayoutDashboard,
  ShoppingBag,
  Package,
  TrendingUp,
  Users,
  UsersRound,
  Flame,
  Truck,
  Percent,
  Scale,
  Upload,
  Store,
  Building2,
  Cable,
  Database,
  FileBarChart2,
  Wallet,
  History,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  ShoppingBag,
  Package,
  TrendingUp,
  Users,
  UsersRound,
  Flame,
  Truck,
  Percent,
  Scale,
  Upload,
  Store,
  Building2,
  Cable,
  Database,
  FileBarChart2,
  Wallet,
  History,
};

export interface NavLinkItem {
  href: string;
  label: string;
  icon: string;
}

export interface NavGroup {
  key: string;
  label: string;
  defaultOpen: boolean;
  items: NavLinkItem[];
}

function isActive(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

function NavLinksInner({
  groups,
  pathname,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
}) {
  // A group starts open when it's a default-open group or holds the active page.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const g of groups) o[g.key] = g.defaultOpen || g.items.some((it) => isActive(it.href, pathname));
    return o;
  });

  return (
    <nav className="flex flex-col gap-2">
      {groups.map((group) => {
        const expanded = open[group.key] ?? group.defaultOpen;
        return (
          <div key={group.key} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setOpen((prev) => ({ ...prev, [group.key]: !expanded }))}
              aria-expanded={expanded}
              className="flex items-center justify-between gap-2 rounded-md px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="truncate">{group.label}</span>
              <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', expanded ? '' : '-rotate-90 rtl:rotate-90')} />
            </button>
            {expanded ? (
              <div className="flex flex-col gap-1">
                {group.items.map((item) => {
                  const Icon = ICONS[item.icon] ?? LayoutDashboard;
                  const active = isActive(item.href, pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

export function NavLinks({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname(); // locale-stripped path
  return <NavLinksInner key={pathname} groups={groups} pathname={pathname} onNavigate={onNavigate} />;
}
