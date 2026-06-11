import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { createParty } from '@/server/finance/parties';
import { partyFields } from '../_fields';

export default async function NewPartyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:finance');
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const tk = (k: string) => t(k);
  const errors = { invalid: tr('err.invalid'), exists: tr('err.exists'), forbidden: tr('err.forbidden') };
  const branches = await prisma.branch.findMany({ where: { isActive: true }, orderBy: { nameEn: 'asc' }, select: { id: true, nameEn: true, nameAr: true } });
  const branchOptions = branches.map((b) => ({ value: b.id, label: locale === 'ar' ? b.nameAr : b.nameEn }));

  return (
    <>
      <BackLink href="/finance/parties" label={tr('back')} />
      <PageHeader title={tr('newTitle', { entity: t('parties') })} />
      <RecordForm
        action={createParty}
        fields={partyFields(tk, locale, branchOptions)}
        locale={locale}
        submitLabel={tr('create')}
        cancelHref="/finance/parties"
        cancelLabel={tr('cancel')}
        errors={errors}
      />
    </>
  );
}
