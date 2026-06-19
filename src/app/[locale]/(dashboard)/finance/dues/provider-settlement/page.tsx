import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { getListOptions } from '@/server/lists/resolver';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm, type FieldDef } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { settleProvider } from '@/server/finance/provider-settlement';

export default async function ProviderSettlementPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:finance');
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const [accounts, paymentMethods] = await Promise.all([
    prisma.financeAccount.findMany({
      where: { isActive: true, currency: 'IQD' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    getListOptions('paymentMethod', locale),
  ]);
  const fields: FieldDef[] = [
    { name: 'partyKey', label: t('providerSettlement.provider'), type: 'select', required: true, options: [
      { value: 'HI_EXPRESS', label: 'Hi-Express' },
      { value: 'WAYL', label: 'Wayl' },
    ] },
    { name: 'accountId', label: t('f.account'), type: 'select', required: true, options: accounts.map((account) => ({ value: account.id, label: account.name })) },
    { name: 'amountReceived', label: t('providerSettlement.received'), type: 'number', required: true, hint: t('providerSettlement.hint') },
    { name: 'paymentMethod', label: t('f.paymentMethod'), type: 'select', options: paymentMethods },
    { name: 'date', label: t('f.date'), type: 'date', required: true },
  ];
  return (
    <>
      <BackLink href="/finance/dues" label={tr('back')} />
      <PageHeader title={t('providerSettlement.title')} subtitle={t('providerSettlement.subtitle')} />
      <RecordForm
        action={settleProvider}
        fields={fields}
        initial={{ date: new Date().toISOString().slice(0, 10) }}
        locale={locale}
        submitLabel={t('providerSettlement.submit')}
        cancelHref="/finance/dues"
        cancelLabel={tr('cancel')}
        errors={{ invalid: tr('err.invalid'), forbidden: tr('err.forbidden'), amount: t('providerSettlement.amountError'), provider: t('providerSettlement.providerError'), account: tr('err.invalid') }}
      />
    </>
  );
}
