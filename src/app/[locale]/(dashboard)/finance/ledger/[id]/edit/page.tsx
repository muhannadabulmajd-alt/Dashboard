import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { toMajor } from '@/lib/money';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { updateEntry } from '@/server/finance/entries';
import { entryFields } from '../../_fields';

export default async function EditEntryPage({
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
  const [entry, accounts, parties, branches] = await Promise.all([
    prisma.financeEntry.findUnique({ where: { id } }),
    prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.party.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { nameEn: 'asc' }, select: { id: true, nameEn: true, nameAr: true } }),
  ]);
  if (!entry || entry.reversedAt || entry.reversalOfId || entry.importKey) notFound();

  // Entries are stored in IQD; if one was paid in a foreign currency, edit it
  // back in that currency + rate so saving re-applies the same conversion.
  const paidUsd = entry.origCurrency === 'USD' && entry.origAmount != null;
  const initial = {
    type: entry.type,
    amount: paidUsd ? toMajor(entry.origAmount as number, 'USD') : toMajor(entry.amount, 'IQD'),
    currency: paidUsd ? 'USD' : 'IQD',
    rate: entry.fxRate ?? '',
    date: entry.date.toISOString().slice(0, 10),
    obligation: entry.obligation ? 'yes' : 'no',
    obligationKind: entry.obligationKind ?? '',
    dueDate: entry.dueDate ? entry.dueDate.toISOString().slice(0, 10) : '',
    accountId: entry.accountId ?? '',
    toAccountId: entry.toAccountId ?? '',
    partyId: entry.partyId ?? '',
    branchId: entry.branchId ?? '',
    categoryType: entry.categoryType ?? '',
    description: entry.description ?? '',
    reference: entry.reference ?? '',
    attachmentUrl: entry.attachmentUrl ?? '',
  };
  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));
  const partyOptions = parties.map((p) => ({ value: p.id, label: p.name }));
  const branchOptions = branches.map((b) => ({ value: b.id, label: locale === 'ar' ? b.nameAr : b.nameEn }));
  const errors = { invalid: tr('err.invalid'), forbidden: tr('err.forbidden') };

  return (
    <>
      <BackLink href={`/finance/ledger/${id}`} label={tr('back')} />
      <PageHeader title={tr('editTitle', { entity: t('recordEntry') })} />
      <RecordForm
        action={updateEntry.bind(null, id)}
        fields={entryFields((k) => t(k), locale, accountOptions, partyOptions, branchOptions)}
        initial={initial}
        locale={locale}
        submitLabel={tr('save')}
        cancelHref={`/finance/ledger/${id}`}
        cancelLabel={tr('cancel')}
        errors={errors}
      />
    </>
  );
}
