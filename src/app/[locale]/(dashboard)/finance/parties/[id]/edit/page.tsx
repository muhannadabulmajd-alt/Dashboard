import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { updateParty } from '@/server/finance/parties';
import { partyFields } from '../../_fields';

export default async function EditPartyPage({
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
  const [p, branches, accounts] = await Promise.all([
    prisma.party.findUnique({ where: { id } }),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { nameEn: 'asc' }, select: { id: true, nameEn: true, nameAr: true } }),
    prisma.financeAccount.findMany({ where: { isActive: true, currency: 'IQD' }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  if (!p) notFound();
  const branchOptions = branches.map((b) => ({ value: b.id, label: locale === 'ar' ? b.nameAr : b.nameEn }));
  const accountOptions = accounts.map((account) => ({ value: account.id, label: account.name }));

  const initial = {
    name: p.name,
    type: p.type,
    phone: p.phone ?? '',
    email: p.email ?? '',
    address: p.address ?? '',
    branchId: p.branchId ?? '',
    openingPayable: p.openingPayable,
    openingReceivable: p.openingReceivable,
    equityShare: p.equityShare ?? '',
    notes: p.notes ?? '',
    defaultSettlementAccountId: p.defaultSettlementAccountId ?? '',
    netFeesFromRemittance: p.netFeesFromRemittance,
    collectsOrderPayments: p.collectsOrderPayments,
  };
  const errors = { invalid: tr('err.invalid'), exists: tr('err.exists'), forbidden: tr('err.forbidden') };

  return (
    <>
      <BackLink href={`/finance/parties/${id}`} label={tr('back')} />
      <PageHeader title={tr('editTitle', { entity: t('parties') })} subtitle={p.name} />
      <RecordForm
        action={updateParty.bind(null, id)}
        fields={partyFields(tk, locale, branchOptions, accountOptions)}
        initial={initial}
        locale={locale}
        submitLabel={tr('save')}
        cancelHref={`/finance/parties/${id}`}
        cancelLabel={tr('cancel')}
        errors={errors}
      />
    </>
  );
}
