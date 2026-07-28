import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { toMajor } from '@/lib/money';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { updateEntry } from '@/server/finance/entries';
import { quickCreateCustomer, quickCreateParty, updateCentralPurchase } from '@/server/finance/central-records';
import { CentralEntryPanel, type CentralEntryInitial } from '@/components/finance/CentralEntryPanel';
import { entryFields } from '../../_fields';

export default async function EditEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'manage:finance');
  const { id } = await params;
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const [entry, accounts, parties, branches] = await Promise.all([
    prisma.financeEntry.findUnique({
      where: { id },
      include: {
        ledgerLines: { orderBy: { lineNo: 'asc' } },
        fixedAssets: { orderBy: { createdAt: 'asc' } },
        settlements: { where: { archivedAt: null, reversedAt: null, reversalOfId: null }, orderBy: { date: 'asc' } },
      },
    }),
    prisma.financeAccount.findMany({
      where: { isActive: true, type: { not: 'PAYMENT_GATEWAY' } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.party.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { nameEn: 'asc' }, select: { id: true, nameEn: true, nameAr: true } }),
  ]);
  const ownerAdmin = user.role === 'OWNER' || user.role === 'ADMIN';
  if (!entry || (!ownerAdmin && (entry.reversedAt || entry.reversalOfId || entry.importKey || entry.archivedAt))) notFound();

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
  const fields = [
    ...entryFields((k) => t(k), locale, accountOptions, partyOptions, branchOptions),
    { name: 'changeReason', label: t('f.changeReason'), type: 'text' as const, hint: t('h.changeReason') },
  ];
  const errors = { invalid: tr('err.invalid'), forbidden: tr('err.forbidden') };

  if (entry.type === 'PURCHASE' && (entry.ledgerLines.length || entry.fixedAssets.length)) {
    if (!ownerAdmin) notFound();
    const paidAmount = entry.settlements.reduce((sum, settlement) => sum + settlement.amount, 0);
    const paymentMode = entry.obligation ? (paidAmount > 0 ? 'PARTIAL' : 'CREDIT') : 'PAID';
    const payment = entry.settlements[0];
    const purchaseInitial: CentralEntryInitial = {
      recordKind: 'STOCK_PURCHASE',
      date: entry.date.toISOString().slice(0, 10),
      currency: paidUsd ? 'USD' : 'IQD',
      rate: entry.fxRate?.toString() ?? '',
      accountId: payment?.accountId ?? entry.accountId ?? '',
      branchId: entry.branchId ?? '',
      partyId: entry.partyId ?? '',
      paymentMode,
      paidAmount: paymentMode === 'PARTIAL' ? toMajor(paidAmount, 'IQD').toString() : '',
      paymentDate: payment?.date.toISOString().slice(0, 10) ?? entry.date.toISOString().slice(0, 10),
      dueDate: entry.dueDate?.toISOString().slice(0, 10) ?? '',
      paymentMethod: payment?.paymentMethod ?? entry.paymentMethod ?? 'CASH',
      reference: entry.reference ?? '',
      description: entry.description ?? '',
      attachmentUrl: entry.attachmentUrl ?? '',
      lines: (entry.ledgerLines.length ? entry.ledgerLines.map((line) => ({
        type: line.itemType as 'INVENTORY' | 'ASSET' | 'EXPENSE' | 'SERVICE' | 'OTHER',
        itemName: line.itemName,
        inventoryItemMode: 'existing',
        inventoryItemId: line.inventoryItemId ?? '',
        newItemNameEn: '',
        newItemNameAr: '',
        newItemCategory: 'PACKAGING',
        categoryType: line.categoryType ?? 'OVERHEAD',
        assetKey: line.assetKey ?? '',
        assetCategory: line.assetCategory ?? 'Equipment',
        unit: line.unit,
        quantity: line.quantity.toString(),
        unitCost: (paidUsd ? Number(line.unitCost) / (entry.fxRate ?? 1) : toMajor(Number(line.unitCost), 'IQD')).toString(),
        discount: (paidUsd ? line.discountAmount / (entry.fxRate ?? 1) : toMajor(line.discountAmount, 'IQD')).toString(),
        extra: (paidUsd ? line.extraAmount / (entry.fxRate ?? 1) : toMajor(line.extraAmount, 'IQD')).toString(),
        notes: line.notes ?? '',
      })) : entry.fixedAssets.map((asset) => ({
        type: 'ASSET' as const,
        itemName: asset.name,
        inventoryItemMode: 'existing' as const,
        inventoryItemId: '',
        newItemNameEn: '',
        newItemNameAr: '',
        newItemCategory: 'PACKAGING',
        categoryType: 'EQUIPMENT',
        assetKey: '',
        assetCategory: asset.category,
        unit: asset.unit,
        quantity: asset.quantity.toString(),
        unitCost: (paidUsd ? Number(asset.unitCost) / (entry.fxRate ?? 1) : toMajor(Number(asset.unitCost), 'IQD')).toString(),
        discount: '0',
        extra: '0',
        notes: asset.notes ?? '',
      }))),
    };
    const inventoryItems = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      orderBy: { nameEn: 'asc' },
      select: { id: true, nameEn: true, nameAr: true, unit: true, category: true },
    });

    return (
      <>
        <BackLink href={`/finance/ledger/${id}`} label={tr('back')} />
        <PageHeader title={tr('editTitle', { entity: t('recordEntry') })} />
        <CentralEntryPanel
          action={updateCentralPurchase.bind(null, id)}
          createParty={quickCreateParty}
          createCustomer={quickCreateCustomer}
          locale={locale}
          today={entry.date.toISOString().slice(0, 10)}
          accounts={accountOptions}
          parties={partyOptions}
          branches={branchOptions}
          inventoryItems={inventoryItems.map((item) => ({
            value: item.id,
            label: `${locale === 'ar' ? item.nameAr : item.nameEn} (${item.unit})`,
            name: locale === 'ar' ? item.nameAr : item.nameEn,
            unit: item.unit,
            category: item.category,
          }))}
          cancelHref={`/finance/ledger/${id}`}
          initial={purchaseInitial}
          lockKind
          editMode
        />
      </>
    );
  }

  return (
    <>
      <BackLink href={`/finance/ledger/${id}`} label={tr('back')} />
      <PageHeader title={tr('editTitle', { entity: t('recordEntry') })} />
      <RecordForm
        action={updateEntry.bind(null, id)}
        fields={fields}
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
