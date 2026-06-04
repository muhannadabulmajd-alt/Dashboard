import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatDate } from '@/lib/dates';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/data-table/DataTable';
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
  ];
  const rows = users.map((u) => [
    u.name,
    u.email,
    enumLabel(u.role, locale),
    <Badge key="s" variant={u.isActive ? 'success' : 'muted'}>
      {u.isActive ? t('active') : t('inactive')}
    </Badge>,
    u.lastLoginAt ? formatDate(u.lastLoginAt, locale) : t('never'),
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
    </>
  );
}
