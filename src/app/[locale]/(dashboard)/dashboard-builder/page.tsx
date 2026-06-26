import { LayoutDashboard, Plus } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { listDashboards, DASHBOARD_TEMPLATES } from '@/server/dashboard-builder/service';
import { createDashboardAction } from '@/server/dashboard-builder/actions';
import { can } from '@/lib/rbac';
import { formatDateTime } from '@/lib/dates';
import { PageHeader, Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui/primitives';
import { Link } from '@/i18n/navigation';

export default async function DashboardBuilderIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'view:dashboard-builder');
  const dashboards = await listDashboards({ id: user.id, role: user.role, branchId: user.branchId });
  const canCreate = can(user.role, 'manage:dashboards');

  return (
    <>
      <PageHeader
        eyebrow="Dashboard Studio"
        title={locale === 'ar' ? 'منشئ لوحات التحكم' : 'Dashboard Builder'}
        subtitle={locale === 'ar' ? 'صمم تقاريرك ولوحاتك من بيانات أطلس الحقيقية.' : 'Design reports and dashboards from trusted Atlas data.'}
      />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-roast">{locale === 'ar' ? 'لوحاتك' : 'Your dashboards'}</h2>
            <Badge variant="muted">{dashboards.length}</Badge>
          </div>
          {dashboards.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {dashboards.map((dashboard) => (
                <Link
                  key={dashboard.id}
                  href={`/dashboard-builder/${dashboard.id}`}
                  className="rounded-[var(--radius)] border bg-card p-4 shadow-[0_1px_0_rgba(83,45,31,0.05)] hover:border-primary/45 hover:bg-linen/20"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-roast">{dashboard.name}</div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{dashboard.description || (locale === 'ar' ? 'لوحة مخصصة' : 'Custom dashboard')}</p>
                    </div>
                    <LayoutDashboard className="size-5 shrink-0 text-primary" />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge variant={dashboard.visibility === 'SHARED' ? 'success' : 'muted'}>{dashboard.visibility === 'SHARED' ? (locale === 'ar' ? 'مشتركة' : 'Shared') : (locale === 'ar' ? 'خاصة' : 'Private')}</Badge>
                    <span>{formatDateTime(dashboard.updatedAt, locale)}</span>
                    <span>{dashboard.ownerName}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <Card variant="surface">
              <CardContent className="flex min-h-48 flex-col items-center justify-center gap-2 text-center">
                <p className="text-sm font-semibold text-roast">{locale === 'ar' ? 'ابدأ بأول لوحة.' : 'Start your first dashboard.'}</p>
                <p className="text-sm text-muted-foreground">{locale === 'ar' ? 'اختر قالباً أو ابدأ من لوحة فارغة.' : 'Choose a template or start blank.'}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {canCreate ? (
          <Card>
            <CardHeader>
              <CardTitle>{locale === 'ar' ? 'إنشاء لوحة' : 'Create dashboard'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createDashboardAction} className="space-y-3">
                <input type="hidden" name="locale" value={locale} />
                <label className="block text-xs font-medium text-muted-foreground">
                  {locale === 'ar' ? 'اسم اللوحة' : 'Dashboard name'}
                  <input name="name" required className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                </label>
                <label className="block text-xs font-medium text-muted-foreground">
                  {locale === 'ar' ? 'الوصف' : 'Description'}
                  <textarea name="description" className="mt-1 min-h-20 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                </label>
                <label className="block text-xs font-medium text-muted-foreground">
                  {locale === 'ar' ? 'القالب' : 'Template'}
                  <select name="templateKey" className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                    <option value="">{locale === 'ar' ? 'لوحة فارغة' : 'Blank dashboard'}</option>
                    {DASHBOARD_TEMPLATES.map((template) => (
                      <option key={template.key} value={template.key}>
                        {locale === 'ar' ? template.nameAr : template.nameEn}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-amber/90">
                  <Plus className="size-4" />
                  {locale === 'ar' ? 'إنشاء' : 'Create'}
                </button>
              </form>
              {can(user.role, 'export:dashboards') ? (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {locale === 'ar' ? 'يمكنك تصدير اللوحات إلى PDF بعد إنشائها.' : 'Dashboards can be exported to PDF after creation.'}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </section>
    </>
  );
}
