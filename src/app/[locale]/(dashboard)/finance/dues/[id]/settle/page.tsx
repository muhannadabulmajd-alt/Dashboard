import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { formatMoney, toMajor } from '@/lib/money';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm, type FieldDef } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { settleEntry } from '@/server/finance/entries';

export default async function SettlePage({
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

  const ob = await prisma.financeEntry.findUnique({
    where: { id },
    include: { party: true, settlements: { select: { amount: true } } },
  });
  if (!ob || !ob.obligation) notFound();

  const paid = ob.settlements.reduce((s, x) => s + x.amount, 0);
  const outstanding = Math.max(0, ob.amount - paid);
  const accounts = await prisma.financeAccount.findMany({
    where: { isActive: true, currency: ob.currency },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  const fields: FieldDef[] = [
    { name: 'amount', label: t('f.amount'), type: 'number', required: true },
    { name: 'accountId', label: t('f.account'), type: 'select', required: true, options: accounts.map((a) => ({ value: a.id, label: a.name })) },
    { name: 'date', label: t('f.date'), type: 'date', required: true },
  ];
  const initial = { amount: toMajor(outstanding, ob.currency), date: new Date().toISOString().slice(0, 10) };
  const errors = { invalid: tr('err.invalid'), forbidden: tr('err.forbidden') };

  return (
    <>
      <BackLink href="/finance/dues" label={tr('back')} />
      <PageHeader
        title={t('settleTitle')}
        subtitle={`${ob.party?.name ?? ''} · ${t('f.outstanding')}: ${formatMoney(outstanding, ob.currency, locale)}`}
      />
      <RecordForm
        action={settleEntry.bind(null, id)}
        fields={fields}
        initial={initial}
        locale={locale}
        submitLabel={t('f.settle')}
        cancelHref="/finance/dues"
        cancelLabel={tr('cancel')}
        errors={errors}
      />
    </>
  );
}
