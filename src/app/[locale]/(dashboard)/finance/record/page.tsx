import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel, EXPENSE_CATEGORY_TYPES } from '@/lib/enums';
import { dateInputValue } from '@/lib/dates';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink } from '@/components/records/parts';
import { SectionGuide } from '@/components/records/SectionGuide';
import { RecordWizard } from '@/components/finance/RecordWizard';

export default async function RecordEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:finance');
  const t = await getTranslations('finance');
  const [accounts, parties, branches] = await Promise.all([
    prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.party.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { nameEn: 'asc' }, select: { id: true, nameEn: true, nameAr: true } }),
  ]);

  return (
    <>
      <BackLink href="/finance" label={t('wizard.back')} />
      <PageHeader title={t('wizard.title')} subtitle={t('wizard.subtitle')} />
      <SectionGuide title={t('wizard.guide.title')} intro={t('wizard.guide.intro')} points={t.raw('wizard.guide.points') as string[]} />
      <RecordWizard
        locale={locale}
        accounts={accounts.map((a) => ({ value: a.id, label: a.name }))}
        parties={parties.map((p) => ({ value: p.id, label: p.name }))}
        categories={EXPENSE_CATEGORY_TYPES.map((c) => ({ value: c, label: enumLabel(c, locale) }))}
        branches={branches.map((b) => ({ value: b.id, label: locale === 'ar' ? b.nameAr : b.nameEn }))}
        today={dateInputValue()}
      />
    </>
  );
}
