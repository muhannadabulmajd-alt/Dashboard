import { Link } from '@/i18n/navigation';

/**
 * Link-based tab strip for record detail pages (URL-driven, server-rendered).
 * Each tab is a `?tab=` link; the active one is highlighted. Matches the
 * switcher styling used on the Products & Variations list.
 */
export function RecordTabs({
  tabs,
  active,
}: {
  tabs: { key: string; label: string; href: string }[];
  active: string;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`rounded-md px-3 py-1.5 font-medium ${
            tab.key === active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
