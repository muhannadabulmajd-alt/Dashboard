import { LogOut } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { Role } from '@prisma/client';
import { signOutAction } from '@/server/auth/actions';
import { enumLabel } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import { Badge } from '@/components/ui/primitives';
import { LocaleSwitcher } from './LocaleSwitcher';

export async function TopBar({
  user,
  locale,
}: {
  user: { name: string; role: Role };
  locale: string;
}) {
  const t = await getTranslations('common');
  const signOut = signOutAction.bind(null, locale);

  return (
    <header className="flex items-center justify-between gap-3 border-b bg-card px-4 py-3">
      <div className="md:hidden text-sm font-bold">Laheeb</div>
      <div className="ms-auto flex items-center gap-3">
        <LocaleSwitcher />
        <div className="hidden items-center gap-2 sm:flex">
          <span className="text-sm font-medium">{user.name}</span>
          <Badge variant="muted">{enumLabel(user.role, locale as AppLocale)}</Badge>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-3.5" />
            <span className="hidden sm:inline">{t('signOut')}</span>
          </button>
        </form>
      </div>
    </header>
  );
}
