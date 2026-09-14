import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel, ROLES } from '@/lib/enums';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { RecordForm, type FieldDef } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { updateUser, setUserActive } from '@/server/records/users';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import { replaceUserLocationAccessAction } from '@/server/inventory-v2/setup-actions';
import { UserLocationAccessEditor } from '@/components/admin/UserLocationAccessEditor';

export default async function EditUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user: actor } = await getPageContext(params, searchParams, 'manage:users');
  const { id } = await params;
  const t = await getTranslations('admin');
  const inventoryV2Enabled = getInventoryV2Config().enabled;

  const [u, branches, financeAccounts, stockLocations] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      include: { stockLocationAccesses: true },
    }),
    prisma.branch.findMany({ select: { id: true, nameEn: true, nameAr: true } }),
    prisma.financeAccount.findMany({
      where: { isActive: true, currency: 'IQD', type: { not: 'PAYMENT_GATEWAY' } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    inventoryV2Enabled
      ? prisma.stockLocation.findMany({
          where: { isActive: true },
          include: { branch: { select: { nameEn: true, nameAr: true } } },
          orderBy: [{ branch: { nameEn: 'asc' } }, { nameEn: 'asc' }],
        })
      : Promise.resolve([]),
  ]);
  if (!u) notFound();

  const fields: FieldDef[] = [
    { name: 'name', label: t('name'), type: 'text', required: true },
    {
      name: 'role',
      label: t('role'),
      type: 'select',
      required: true,
      options: ROLES.map((r) => ({ value: r, label: enumLabel(r, locale) })),
    },
    {
      name: 'branchId',
      label: t('branch'),
      type: 'select',
      options: branches.map((b) => ({ id: b.id, name: locale === 'ar' ? b.nameAr : b.nameEn })).map((b) => ({ value: b.id, label: b.name })),
    },
    {
      name: 'defaultFinanceAccountId',
      label: t('defaultFinanceAccount'),
      type: 'select',
      options: financeAccounts.map((account) => ({ value: account.id, label: account.name })),
    },
  ];
  const initial = {
    name: u.name,
    role: u.role,
    branchId: u.branchId ?? '',
    defaultFinanceAccountId: u.defaultFinanceAccountId ?? '',
  };
  const errors = {
    invalid: t('invalid'),
    forbidden: t('forbidden'),
    self: t('self'),
    lastOwner: t('lastOwner'),
    notfound: t('notfound'),
  };
  const isSelf = u.id === actor.id;

  return (
    <>
      <BackLink href="/admin/users" label={t('cancel')} />
      <PageHeader title={t('editUser')} subtitle={u.email} />
      <RecordForm
        action={updateUser.bind(null, id)}
        fields={fields}
        initial={initial}
        locale={locale}
        submitLabel={t('save')}
        cancelHref="/admin/users"
        cancelLabel={t('cancel')}
        errors={errors}
      />

      {inventoryV2Enabled ? (
        <UserLocationAccessEditor
          action={replaceUserLocationAccessAction.bind(null, u.id)}
          locale={locale}
          initialDefaultLocationId={u.defaultStockLocationId ?? ''}
          locations={stockLocations.map((location) => ({
            id: location.id,
            type: location.type,
            label: locale === 'ar'
              ? `${location.nameAr} · ${location.branch.nameAr}`
              : `${location.nameEn} · ${location.branch.nameEn}`,
            access: u.stockLocationAccesses.find((access) => access.locationId === location.id),
          }))}
          labels={{
            title: t('locationAccess.title'),
            hint: t('locationAccess.hint'),
            defaultLocation: t('locationAccess.defaultLocation'),
            location: t('locationAccess.location'),
            canView: t('locationAccess.canView'),
            canSell: t('locationAccess.canSell'),
            canReceive: t('locationAccess.canReceive'),
            canCount: t('locationAccess.canCount'),
            canRecordExpense: t('locationAccess.canRecordExpense'),
            canProduce: t('locationAccess.canProduce'),
            canDispatch: t('locationAccess.canDispatch'),
            canApprove: t('locationAccess.canApprove'),
            save: t('save'),
          }}
          errors={{
            invalid: t('invalid'),
            forbidden: t('forbidden'),
            user_not_found: t('notfound'),
            location_not_found: t('locationAccess.locationNotFound'),
            default_location_not_allowed: t('locationAccess.defaultNotAllowed'),
          }}
        />
      ) : null}

      {!isSelf ? (
        <section className="mt-4 flex items-center justify-between gap-3 rounded-[var(--radius)] border bg-card p-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{t('accountStatus')}:</span>
            <Badge variant={u.isActive ? 'success' : 'muted'}>{u.isActive ? t('active') : t('inactive')}</Badge>
          </div>
          <form action={setUserActive.bind(null, id, locale, !u.isActive)}>
            <button
              type="submit"
              className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              {u.isActive ? t('deactivate') : t('activate')}
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
