import { LogOut } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { Role } from '@prisma/client';
import { signOutAction } from '@/server/auth/actions';
import { enumLabel } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import { Badge } from '@/components/ui/primitives';
import { LocaleSwitcher } from './LocaleSwitcher';
import { MobileNav } from './MobileNav';
import type { NavGroup } from './NavLinks';

export async function TopBar({
  user,
  locale,
  navGroups,
}: {
  user: { name: string; role: Role };
  locale: string;
  navGroups: NavGroup[];
}) {
  const t = await getTranslations('common');
  const tApp = await getTranslations('app');
  const signOut = signOutAction.bind(null, locale);

  return (
    <header className="flex items-center justify-between gap-3 border-b border-border/80 bg-card/88 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2 md:hidden">
        <MobileNav groups={navGroups} title={tApp('short')} />
        <span className="text-sm font-bold text-roast">{tApp('short')}</span>
      </div>
      <div className="ms-auto flex items-center gap-3">
        <LocaleSwitcher />
        <div className="hidden items-center gap-2 sm:flex">
          <span className="text-sm font-semibold text-roast">{user.name}</span>
          <Badge variant="muted">{enumLabel(user.role, locale as AppLocale)}</Badge>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-card px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-linen/45 hover:text-roast"
          >
            <LogOut className="size-3.5" />
            <span className="hidden sm:inline">{t('signOut')}</span>
          </button>
        </form>
      </div>
    </header>
  );
}
