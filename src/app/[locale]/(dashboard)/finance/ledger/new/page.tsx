import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink } from '@/components/records/parts';
import { CentralEntryPanel, type RecordKind } from '@/components/finance/CentralEntryPanel';
import { createCentralRecord, quickCreateCustomer, quickCreateParty } from '@/server/finance/central-records';
import { dateInputValue } from '@/lib/dates';

const RECORD_KINDS: readonly RecordKind[] = [
  'MONEY_IN',
  'MONEY_OUT',
  'STOCK_PURCHASE',
  'ASSET_PURCHASE',
  'CUSTOMER_DUE',
  'SUPPLIER_DUE',
  'TRANSFER',
  'CAPITAL_IN',
  'DRAWING',
];

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:finance');
  const rawParams = await searchParams;
  const kindParam = one(rawParams.kind);
  const partyIdParam = one(rawParams.partyId);
  const initialKind = RECORD_KINDS.includes(kindParam as RecordKind) ? (kindParam as RecordKind) : undefined;
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const [accounts, parties, branches, inventoryItems] = await Promise.all([
    prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, currency: true } }),
    prisma.party.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, type: true } }),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { nameEn: 'asc' }, select: { id: true, nameEn: true, nameAr: true } }),
    prisma.inventoryItem.findMany({
      where: { isActive: true },
      orderBy: { nameEn: 'asc' },
      select: { id: true, nameEn: true, nameAr: true, unit: true, category: true },
    }),
  ]);
  const accountOptions = accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }));
  const partyOptions = parties.map((p) => ({ value: p.id, label: `${p.name} · ${p.type.toLowerCase().replaceAll('_', ' ')}`, type: p.type }));
  const branchOptions = branches.map((b) => ({ value: b.id, label: locale === 'ar' ? b.nameAr : b.nameEn }));
  const inventoryOptions = inventoryItems.map((item) => ({
    value: item.id,
    label: `${locale === 'ar' ? item.nameAr : item.nameEn} (${item.unit})`,
    name: locale === 'ar' ? item.nameAr : item.nameEn,
    unit: item.unit,
    category: item.category,
  }));

  return (
    <>
      <BackLink href="/finance/ledger" label={tr('back')} />
      <PageHeader title={t('recordEntry')} subtitle={t('centralEntrySubtitle')} />
      <CentralEntryPanel
        action={createCentralRecord}
        createParty={quickCreateParty}
        createCustomer={quickCreateCustomer}
        locale={locale}
        today={dateInputValue()}
        accounts={accountOptions}
        parties={partyOptions}
        inventoryItems={inventoryOptions}
        branches={branchOptions}
        initial={{ recordKind: initialKind, partyId: partyIdParam }}
        cancelHref="/finance/ledger"
      />
    </>
  );
}
