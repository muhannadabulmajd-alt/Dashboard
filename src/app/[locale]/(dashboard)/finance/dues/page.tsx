import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { Link } from '@/i18n/navigation';

export default async function DuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'view:finance');
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const tc = await getTranslations('common');

  const obligations = await prisma.financeEntry.findMany({
    where: { obligation: true },
    include: { party: { select: { name: true } }, settlements: { select: { amount: true } } },
    orderBy: { dueDate: 'asc' },
  });
  const now = new Date();

  const open = (kind: 'PAYABLE' | 'RECEIVABLE') =>
    obligations
      .filter((o) => o.obligationKind === kind)
      .map((o) => {
        const paid = o.settlements.reduce((s, x) => s + x.amount, 0);
        return { o, paid, outstanding: Math.max(0, o.amount - paid) };
      })
      .filter((x) => x.outstanding > 0);

  const cols: Column[] = [
    { label: t('f.party') },
    { label: t('f.description') },
    { label: t('f.amount'), align: 'end' },
    { label: t('f.paid'), align: 'end' },
    { label: t('f.outstanding'), align: 'end' },
    { label: t('f.dueDate') },
    { label: '', align: 'end' },
  ];
  const toRows = (items: ReturnType<typeof open>) =>
    items.map(({ o, paid, outstanding }) => {
      const overdue = o.dueDate ? o.dueDate < now : false;
      return [
        o.party?.name ?? '—',
        o.description ?? enumLabel(o.type, locale),
        formatMoney(o.amount, o.currency, locale),
        formatMoney(paid, o.currency, locale),
        formatMoney(outstanding, o.currency, locale),
        o.dueDate ? (
          <span key="d" className={overdue ? 'font-medium text-danger' : undefined}>
            {formatDate(o.dueDate, locale)}
            {overdue ? ` · ${t('overdue')}` : ''}
          </span>
        ) : (
          '—'
        ),
        <Link key="s" href={`/finance/dues/${o.id}/settle`} className="font-medium text-primary hover:underline">
          {t('f.settle')}
        </Link>,
      ];
    });

  return (
    <>
      <BackLink href="/finance" label={tr('back')} />
      <PageHeader title={t('dues')} subtitle={t('subtitle')} />
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('payables')}</h3>
        <DataTable
          columns={cols}
          rows={toRows(open('PAYABLE'))}
          emptyLabel={t('noDues')}
          exportHref={`/api/finance/export?type=dues&kind=PAYABLE&locale=${locale}`}
          exportLabel={tc('exportCsv')}
        />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('receivables')}</h3>
        <DataTable
          columns={cols}
          rows={toRows(open('RECEIVABLE'))}
          emptyLabel={t('noDues')}
          exportHref={`/api/finance/export?type=dues&kind=RECEIVABLE&locale=${locale}`}
          exportLabel={tc('exportCsv')}
        />
      </section>
    </>
  );
}
