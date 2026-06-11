import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { RecordActions } from '@/components/records/RecordActions';
import { reverseEntry } from '@/server/finance/entries';

export default async function EntryDetailPage({
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

  const e = await prisma.financeEntry.findUnique({
    where: { id },
    include: { party: true, account: true, toAccount: true },
  });
  if (!e) notFound();
  const [branch, createdBy, reversedBy] = await Promise.all([
    e.branchId ? prisma.branch.findUnique({ where: { id: e.branchId }, select: { nameEn: true, nameAr: true } }) : null,
    e.createdById ? prisma.user.findUnique({ where: { id: e.createdById }, select: { name: true, email: true } }) : null,
    e.reversedById ? prisma.user.findUnique({ where: { id: e.reversedById }, select: { name: true, email: true } }) : null,
  ]);
  const branchName = branch ? (locale === 'ar' ? branch.nameAr : branch.nameEn) : '—';
  const isReversed = Boolean(e.reversedAt);
  const isReversalMarker = Boolean(e.reversalOfId);
  const managedBySync = Boolean(e.importKey);

  const items: DetailField[] = [
    { label: t('f.transactionId'), value: e.id },
    { label: t('f.type'), value: enumLabel(e.type, locale) },
    { label: t('f.amount'), value: formatMoney(e.amount, e.currency, locale) },
    ...(e.origCurrency === 'USD' && e.origAmount != null
      ? [{ label: t('f.origPaid'), value: `${formatMoney(e.origAmount, 'USD', locale)} × ${e.fxRate ?? '—'}` }]
      : []),
    { label: t('f.date'), value: formatDate(e.date, locale) },
    {
      label: t('f.status'),
      value: (
        <Badge variant={isReversalMarker ? 'muted' : isReversed ? 'danger' : e.obligation ? 'warning' : 'success'}>
          {isReversalMarker ? t('reversalMarker') : isReversed ? t('reversed') : e.obligation ? t('f.due') : t('f.paid')}
        </Badge>
      ),
    },
    { label: t('f.kind'), value: e.obligationKind ? enumLabel(e.obligationKind, locale) : '—' },
    { label: t('f.dueDate'), value: e.dueDate ? formatDate(e.dueDate, locale) : '—' },
    { label: t('f.account'), value: e.account?.name ?? '—' },
    { label: t('f.toAccount'), value: e.toAccount?.name ?? '—' },
    { label: t('f.party'), value: e.party?.name ?? '—' },
    { label: t('f.category'), value: e.categoryType ? enumLabel(e.categoryType, locale) : '—' },
    { label: t('f.branch'), value: branchName },
    { label: t('f.related'), value: e.orderId ?? e.importKey ?? '—' },
    { label: t('f.createdBy'), value: createdBy ? createdBy.name || createdBy.email : '—' },
    { label: t('f.description'), value: e.description ?? '—' },
    { label: t('f.reference'), value: e.reference ?? '—' },
    {
      label: t('f.attachmentUrl'),
      value: e.attachmentUrl ? (
        <a href={e.attachmentUrl} className="font-medium text-primary hover:underline" target="_blank" rel="noreferrer">
          {t('viewAttachment')}
        </a>
      ) : '—',
    },
    { label: t('reversalOf'), value: e.reversalOfId ?? '—' },
    { label: t('reversedAt'), value: e.reversedAt ? formatDate(e.reversedAt, locale) : '—' },
    { label: t('reversedBy'), value: reversedBy ? reversedBy.name || reversedBy.email : '—' },
    { label: t('reversalReason'), value: e.reversalReason ?? '—' },
  ];

  return (
    <>
      <BackLink href="/finance/ledger" label={tr('back')} />
      <PageHeader title={enumLabel(e.type, locale)} subtitle={formatMoney(e.amount, e.currency, locale)} />
      <RecordActions
        editHref={!isReversed && !isReversalMarker && !managedBySync ? `/finance/ledger/${e.id}/edit` : undefined}
        deleteAction={!isReversed && !isReversalMarker && !managedBySync ? reverseEntry.bind(null, e.id, locale) : undefined}
        labels={{
          edit: tr('edit'),
          archive: tr('archive'),
          restore: tr('restore'),
          delete: t('reverse'),
          confirm: t('confirmReverse'),
        }}
      />
      <DetailGrid items={items} />
    </>
  );
}
