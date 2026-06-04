import { requireUser } from '@/server/auth/rbac';
import { buildBranchScope } from '@/server/filters/where-builder';
import { getLatestOrderDate } from '@/server/db/repositories/sales.repo';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { StaleDataBanner } from '@/components/layout/StaleDataBanner';
import { FilterBar } from '@/components/filters/FilterBar';
import type { AppLocale } from '@/lib/money';

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await requireUser(locale);
  const scope = buildBranchScope(user);
  const lastUpdated = await getLatestOrderDate(scope);

  return (
    <div className="flex min-h-screen">
      <Sidebar role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={{ name: user.name, role: user.role }} locale={locale} />
        <StaleDataBanner lastUpdated={lastUpdated} locale={locale as AppLocale} />
        <FilterBar />
        <main className="flex-1 space-y-6 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
