import { getTranslations } from 'next-intl/server';
import { Plus } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { Link } from '@/i18n/navigation';

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:finance');
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');

  const entries = await prisma.financeEntry.findMany({
    orderBy: { date: 'desc' },
    take: 300,
    include: { party: { select: { name: true } } },
  });

  const cols: Column[] = [
    { label: t('f.date') },
    { label: t('f.type') },
    { label: t('f.party') },
    { label: t('f.amount'), align: 'end' },
    { label: t('f.status') },
    { label: '', align: 'end' },
  ];
  const rows = entries.map((e) => [
    formatDate(e.date, locale),
    enumLabel(e.type, locale),
    e.party?.name ?? '—',
    formatMoney(e.amount, e.currency, locale),
    <Badge key="s" variant={e.obligation ? 'warning' : 'success'}>
      {e.obligation ? t('f.due') : t('f.paid')}
    </Badge>,
    <Link key="o" href={`/finance/ledger/${e.id}`} className="font-medium text-primary hover:underline">
      {tr('open')}
    </Link>,
  ]);

  return (
    <>
      <BackLink href="/finance" label={tr('back')} />
      <div className="flex items-center justify-between gap-3">
        <PageHeader title={t('ledger')} subtitle={tr('total', { n: entries.length })} />
        <Link
          href="/finance/ledger/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
        >
          <Plus className="size-4" />
          {tr('add')}
        </Link>
      </div>
      <DataTable columns={cols} rows={rows} emptyLabel={tr('none')} />
    </>
  );
}
