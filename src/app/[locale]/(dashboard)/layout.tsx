import { requireUser } from '@/server/auth/rbac';
import { buildBranchScope } from '@/server/filters/where-builder';
import { getLatestActivityDate } from '@/server/db/repositories/sales.repo';
import { prisma } from '@/server/db/client';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { getNavGroups } from '@/components/layout/nav';
import { GlobalQuickAdd } from '@/components/layout/GlobalQuickAdd';
import { getQuickAddItems } from '@/components/layout/quick-add';
import { StaleDataBanner } from '@/components/layout/StaleDataBanner';
import { FilterBar } from '@/components/filters/FilterBar';
import { getListOptions } from '@/server/lists/resolver';
import type { AppLocale } from '@/lib/money';
import { getTranslations } from 'next-intl/server';

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
  const lastUpdated = await getLatestActivityDate(scope);
  const navGroups = await getNavGroups(user.role);
  const quickAddItems = await getQuickAddItems(user.role);
  const tQuickAdd = await getTranslations('quickAdd');

  // Branch filter is shown only to non-scoped roles (others are locked to their branch).
  const branchOptions = scope.branchId
    ? undefined
    : (
        await prisma.branch.findMany({
          where: { isActive: true },
          select: { id: true, nameEn: true, nameAr: true },
          orderBy: { createdAt: 'asc' },
        })
      ).map((b) => ({ value: b.id, label: locale === 'ar' ? b.nameAr : b.nameEn }));

  // Global filter options come from the managed system lists (§9).
  const [channel, governorate, productLine, grind] = await Promise.all([
    getListOptions('channel', locale as AppLocale),
    getListOptions('governorate', locale as AppLocale),
    getListOptions('productLine', locale as AppLocale),
    getListOptions('grind', locale as AppLocale),
  ]);
  const listOptions = { channel, governorate, productLine, grind };

  return (
    <div className="app-surface flex min-h-screen overflow-x-clip">
      <Sidebar groups={navGroups} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={{ name: user.name, role: user.role }} locale={locale} navGroups={navGroups} />
        <StaleDataBanner lastUpdated={lastUpdated} locale={locale as AppLocale} />
        <FilterBar branchOptions={branchOptions} listOptions={listOptions} />
        <main className="min-w-0 flex-1 space-y-5 overflow-x-clip p-3 sm:p-4 lg:space-y-6 lg:p-6">{children}</main>
        <GlobalQuickAdd
          items={quickAddItems}
          title={tQuickAdd('title')}
          subtitle={tQuickAdd('subtitle')}
          buttonLabel={tQuickAdd('buttonLabel')}
          closeLabel={tQuickAdd('closeLabel')}
        />
      </div>
    </div>
  );
}
