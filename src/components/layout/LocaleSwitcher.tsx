'use client';

import { useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const params = useSearchParams().toString();
  const href = params ? `${pathname}?${params}` : pathname;

  const base = 'rounded-md px-2 py-1 text-xs font-bold transition-colors';
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-linen/30 p-0.5">
      <Link
        href={href}
        locale="ar"
        className={cn(base, locale === 'ar' ? 'bg-grove text-primary-foreground' : 'text-muted-foreground hover:text-roast')}
      >
        ع
      </Link>
      <Link
        href={href}
        locale="en"
        className={cn(base, locale === 'en' ? 'bg-grove text-primary-foreground' : 'text-muted-foreground hover:text-roast')}
      >
        EN
      </Link>
    </div>
  );
}
