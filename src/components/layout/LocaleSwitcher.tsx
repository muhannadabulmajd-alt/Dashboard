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

  const base = 'rounded-md px-2 py-1 text-xs font-medium transition-colors';
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-card p-0.5">
      <Link
        href={href}
        locale="ar"
        className={cn(base, locale === 'ar' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
      >
        ع
      </Link>
      <Link
        href={href}
        locale="en"
        className={cn(base, locale === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
      >
        EN
      </Link>
    </div>
  );
}
