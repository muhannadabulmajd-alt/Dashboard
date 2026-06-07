import { Info } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { formatDate } from '@/lib/dates';
import type { AppLocale } from '@/lib/money';

export async function StaleDataBanner({
  lastUpdated,
  locale,
}: {
  lastUpdated: Date | null;
  locale: AppLocale;
}) {
  if (!lastUpdated) return null;
  const t = await getTranslations('stale');
  return (
    <div className="flex items-center justify-center gap-1.5 border-b bg-muted/40 px-4 py-1 text-center text-xs text-muted-foreground">
      <Info className="size-3.5 shrink-0" />
      {t('warning', { date: formatDate(lastUpdated, locale) })}
    </div>
  );
}
