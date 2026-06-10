import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { dateInputValue } from '@/lib/dates';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { updateBranch } from '@/server/branches/actions';
import { getListOptions } from '@/server/lists/resolver';
import { branchFields } from '../../_fields';

export default async function EditBranchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:branches');
  const { id } = await params;
  const t = await getTranslations('branches');
  const tr = await getTranslations('records');
  const [b, governorates] = await Promise.all([
    prisma.branch.findUnique({ where: { id } }),
    getListOptions('governorate', locale),
  ]);
  if (!b) notFound();

  const initial: Record<string, string | number | boolean | null | undefined> = {
    code: b.code,
    nameEn: b.nameEn,
    nameAr: b.nameAr,
    branchType: b.branchType,
    governorate: b.governorate,
    city: b.city,
    address: b.address,
    street: b.street,
    notes: b.notes,
    phone: b.phone,
    email: b.email,
    managerName: b.managerName,
    managerPhone: b.managerPhone,
    managerEmail: b.managerEmail,
    franchiseeName: b.franchiseeName,
    franchiseePhone: b.franchiseePhone,
    franchiseeEmail: b.franchiseeEmail,
    agreementStart: b.agreementStart ? dateInputValue(b.agreementStart) : '',
    agreementEnd: b.agreementEnd ? dateInputValue(b.agreementEnd) : '',
    openingDate: b.openingDate ? dateInputValue(b.openingDate) : '',
    operatingHours: b.operatingHours,
    hasDelivery: b.hasDelivery,
    hasPos: b.hasPos,
    trackInventory: b.trackInventory,
    hasWarehouse: b.hasWarehouse,
  };
  const errors = { invalid: tr('err.invalid'), exists: t('exists'), forbidden: tr('err.forbidden') };

  return (
    <>
      <BackLink href={`/admin/branches/${b.id}`} label={tr('back')} />
      <PageHeader title={t('editTitle')} subtitle={b.code} />
      <RecordForm
        action={updateBranch.bind(null, b.id)}
        fields={branchFields((k) => t(k), locale, 'edit', governorates)}
        initial={initial}
        locale={locale}
        submitLabel={tr('save')}
        cancelHref={`/admin/branches/${b.id}`}
        cancelLabel={tr('cancel')}
        errors={errors}
      />
    </>
  );
}
