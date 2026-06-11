import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { createEntry } from '@/server/finance/entries';
import { entryFields } from '../_fields';

export default async function NewEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:finance');
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const [accounts, parties, branches] = await Promise.all([
    prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.party.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { nameEn: 'asc' }, select: { id: true, nameEn: true, nameAr: true } }),
  ]);
  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));
  const partyOptions = parties.map((p) => ({ value: p.id, label: p.name }));
  const branchOptions = branches.map((b) => ({ value: b.id, label: locale === 'ar' ? b.nameAr : b.nameEn }));
  const errors = { invalid: tr('err.invalid'), forbidden: tr('err.forbidden') };

  return (
    <>
      <BackLink href="/finance/ledger" label={tr('back')} />
      <PageHeader title={t('recordEntry')} subtitle={t('subtitle')} />
      <RecordForm
        action={createEntry}
        fields={entryFields((k) => t(k), locale, accountOptions, partyOptions, branchOptions)}
        initial={{ obligation: 'no', currency: 'IQD' }}
        locale={locale}
        submitLabel={tr('create')}
        cancelHref="/finance/ledger"
        cancelLabel={tr('cancel')}
        errors={errors}
      />
    </>
  );
}
