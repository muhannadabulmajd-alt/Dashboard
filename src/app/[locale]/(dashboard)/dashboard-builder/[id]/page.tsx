import { notFound } from 'next/navigation';
import { Copy, Trash2 } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { getDashboard } from '@/server/dashboard-builder/service';
import { deleteDashboardAction, duplicateDashboardAction, saveDashboardConfigAction, updateDashboardMetaAction } from '@/server/dashboard-builder/actions';
import { PageHeader, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { DashboardBuilderCanvas } from '@/components/dashboard-builder/DashboardBuilderCanvas';
import { BackLink } from '@/components/records/parts';

export default async function DashboardBuilderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await params;
  const { locale, user, filters } = await getPageContext(Promise.resolve({ locale: resolvedParams.locale }), searchParams, 'view:dashboard-builder');
  const dashboard = await getDashboard({ id: user.id, role: user.role, branchId: user.branchId }, resolvedParams.id);
  if (!dashboard) notFound();
  const metaAction = updateDashboardMetaAction.bind(null, dashboard.id);
  const duplicateAction = duplicateDashboardAction.bind(null, dashboard.id, locale);
  const deleteAction = deleteDashboardAction.bind(null, dashboard.id, locale);

  return (
    <>
      <BackLink href="/dashboard-builder" label={locale === 'ar' ? 'لوحات التحكم' : 'Dashboards'} />
      <PageHeader
        eyebrow="Dashboard Studio"
        title={dashboard.name}
        subtitle={dashboard.description ?? (locale === 'ar' ? 'لوحة مخصصة' : 'Custom dashboard')}
      />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 lg:col-span-2">
          <DashboardBuilderCanvas
            dashboardId={dashboard.id}
            initialConfig={dashboard.config}
            runtimeFilters={filters}
            locale={locale}
            canEdit={dashboard.canEdit}
            canExport={dashboard.canExport}
            saveConfig={saveDashboardConfigAction}
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{locale === 'ar' ? 'إعدادات اللوحة' : 'Dashboard settings'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={metaAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="locale" value={locale} />
              <label className="text-xs font-medium text-muted-foreground">
                {locale === 'ar' ? 'الاسم' : 'Name'}
                <input name="name" defaultValue={dashboard.name} disabled={!dashboard.canEdit} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60" />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                {locale === 'ar' ? 'الظهور' : 'Visibility'}
                <select name="visibility" defaultValue={dashboard.visibility} disabled={!dashboard.canDelete} className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60">
                  <option value="PRIVATE">{locale === 'ar' ? 'خاصة' : 'Private'}</option>
                  <option value="SHARED">{locale === 'ar' ? 'مشتركة' : 'Shared'}</option>
                </select>
              </label>
              <label className="text-xs font-medium text-muted-foreground sm:col-span-2">
                {locale === 'ar' ? 'الوصف' : 'Description'}
                <textarea name="description" defaultValue={dashboard.description ?? ''} disabled={!dashboard.canEdit} className="mt-1 min-h-20 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60" />
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <input name="isPinned" type="checkbox" defaultChecked={dashboard.isPinned} disabled={!dashboard.canEdit} />
                {locale === 'ar' ? 'تثبيت اللوحة' : 'Pin dashboard'}
              </label>
              {dashboard.canEdit ? (
                <button className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-amber/90">
                  {locale === 'ar' ? 'حفظ الإعدادات' : 'Save settings'}
                </button>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <Card variant="surface">
          <CardHeader>
            <CardTitle>{locale === 'ar' ? 'إجراءات' : 'Actions'}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <form action={duplicateAction}>
              <button className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-semibold hover:bg-linen/40">
                <Copy className="size-4" />
                {locale === 'ar' ? 'نسخ اللوحة' : 'Duplicate'}
              </button>
            </form>
            {dashboard.canDelete ? (
              <form action={deleteAction}>
                <button className="inline-flex items-center gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger hover:bg-danger-soft/70">
                  <Trash2 className="size-4" />
                  {locale === 'ar' ? 'حذف اللوحة' : 'Delete'}
                </button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
