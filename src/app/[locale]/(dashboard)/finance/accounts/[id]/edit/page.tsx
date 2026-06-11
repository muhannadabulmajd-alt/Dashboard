import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { updateAccount } from '@/server/finance/accounts';
import { accountFields } from '../../_fields';

export default async function EditAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:finance');
  const { id } = await params;
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const tk = (k: string) => t(k);

  const [a, branches] = await Promise.all([
    prisma.financeAccount.findUnique({ where: { id } }),
    prisma.branch.findMany({ select: { id: true, nameEn: true, nameAr: true } }),
  ]);
  if (!a) notFound();
  const branchOptions = branches.map((b) => ({ value: b.id, label: locale === 'ar' ? b.nameAr : b.nameEn }));

  const initial = {
    name: a.name,
    type: a.type,
    currency: a.currency,
    bankName: a.bankName ?? '',
    branchId: a.branchId ?? '',
    openingBalance: a.openingBalance,
    notes: a.notes ?? '',
  };
  const errors = { invalid: tr('err.invalid'), exists: tr('err.exists'), forbidden: tr('err.forbidden') };

  return (
    <>
      <BackLink href={`/finance/accounts/${id}`} label={tr('back')} />
      <PageHeader title={tr('editTitle', { entity: t('accounts') })} subtitle={a.name} />
      <RecordForm
        action={updateAccount.bind(null, id)}
        fields={accountFields(tk, locale, branchOptions)}
        initial={initial}
        locale={locale}
        submitLabel={tr('save')}
        cancelHref={`/finance/accounts/${id}`}
        cancelLabel={tr('cancel')}
        errors={errors}
      />
    </>
  );
}
