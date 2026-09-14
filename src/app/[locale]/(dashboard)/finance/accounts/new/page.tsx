import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { createAccount } from '@/server/finance/accounts';
import { accountFields } from '../_fields';
import { getInventoryV2Config } from '@/server/inventory-v2/config';

export default async function NewAccountPage({
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
  const errors = {
    invalid: tr('err.invalid'),
    invalid_location: t('invalidAccountLocation'),
    exists: tr('err.exists'),
    forbidden: tr('err.forbidden'),
  };

  const inventoryV2Enabled = getInventoryV2Config().enabled;
  const [branches, locations] = await Promise.all([
    prisma.branch.findMany({ select: { id: true, nameEn: true, nameAr: true } }),
    inventoryV2Enabled
      ? prisma.stockLocation.findMany({
        where: { isActive: true, isSystem: false },
        select: {
          id: true,
          nameEn: true,
          nameAr: true,
          branch: { select: { nameEn: true, nameAr: true } },
        },
        orderBy: [{ branch: { nameEn: 'asc' } }, { nameEn: 'asc' }],
      })
      : Promise.resolve([]),
  ]);
  const branchOptions = branches.map((b) => ({ value: b.id, label: locale === 'ar' ? b.nameAr : b.nameEn }));
  const locationOptions = locations.map((location) => ({
    value: location.id,
    label: locale === 'ar'
      ? `${location.nameAr} · ${location.branch.nameAr}`
      : `${location.nameEn} · ${location.branch.nameEn}`,
  }));

  return (
    <>
      <BackLink href="/finance/accounts" label={tr('back')} />
      <PageHeader title={tr('newTitle', { entity: t('accounts') })} />
      <RecordForm
        action={createAccount}
        fields={accountFields(tk, locale, branchOptions, locationOptions)}
        locale={locale}
        submitLabel={tr('create')}
        cancelHref="/finance/accounts"
        cancelLabel={tr('cancel')}
        errors={errors}
      />
    </>
  );
}
