import { getTranslations } from 'next-intl/server';
import { Check, Minus } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel, ROLES } from '@/lib/enums';
import { formatDate } from '@/lib/dates';
import { can } from '@/lib/rbac';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/data-table/DataTable';
import { Link } from '@/i18n/navigation';
import { CreateUserForm } from './CreateUserForm';

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:users');
  const t = await getTranslations('admin');

  const [users, branches] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true },
    }),
    prisma.branch.findMany({ select: { id: true, nameEn: true, nameAr: true } }),
  ]);

  const branchOptions = branches.map((b) => ({ id: b.id, name: locale === 'ar' ? b.nameAr : b.nameEn }));

  const cols = [
    { label: t('name') },
    { label: t('email') },
    { label: t('role') },
    { label: t('status') },
    { label: t('lastLogin'), align: 'end' as const },
    { label: t('actions'), align: 'end' as const },
  ];
  const rows = users.map((u) => [
    u.name,
    u.email,
    enumLabel(u.role, locale),
    <Badge key="s" variant={u.isActive ? 'success' : 'muted'}>
      {u.isActive ? t('active') : t('inactive')}
    </Badge>,
    u.lastLoginAt ? formatDate(u.lastLoginAt, locale) : t('never'),
    <Link key="e" href={`/admin/users/${u.id}/edit`} className="font-medium text-primary hover:underline">
      {t('edit')}
    </Link>,
  ]);

  // Role → access reference (high-level groups, derived from the capability map).
  const groups: { key: string; cap: Parameters<typeof can>[1] }[] = [
    { key: 'grpDashboards', cap: 'view:dashboard' },
    { key: 'grpFinancials', cap: 'view:financial' },
    { key: 'grpManageData', cap: 'view:records' },
    { key: 'grpAdmin', cap: 'manage:users' },
  ];
  const yes = <Check className="mx-auto size-4 text-success" />;
  const no = <Minus className="mx-auto size-4 text-muted-foreground/40" />;
  const matrixCols = [{ label: t('role') }, ...groups.map((g) => ({ label: t(g.key), align: 'end' as const }))];
  const matrixRows = ROLES.map((r) => [
    enumLabel(r, locale),
    ...groups.map((g) => (can(r, g.cap) ? yes : no)),
  ]);

  return (
    <>
      <PageHeader title={t('usersTitle')} subtitle={t('usersSubtitle')} />
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('createUser')}</h3>
        <CreateUserForm branches={branchOptions} />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('existing')}</h3>
        <DataTable columns={cols} rows={rows} emptyLabel="—" />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('rolesAccess')}</h3>
        <p className="text-xs text-muted-foreground">{t('rolesAccessHint')}</p>
        <DataTable columns={matrixCols} rows={matrixRows} emptyLabel="—" />
      </section>
    </>
  );
}
