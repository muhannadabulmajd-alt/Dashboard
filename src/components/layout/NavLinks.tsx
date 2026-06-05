'use client';

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
};

export interface NavLinkItem {
  href: string;
  label: string;
  icon: string;
}

export function NavLinks({ items }: { items: NavLinkItem[] }) {
  const pathname = usePathname(); // locale-stripped path

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = ICONS[item.icon] ?? LayoutDashboard;
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
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
    </nav>
  );
}
