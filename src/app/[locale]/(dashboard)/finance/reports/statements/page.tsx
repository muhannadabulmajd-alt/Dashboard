import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getPartyStatementsReport, type PartyStatementRow } from '@/server/finance/reports';
import { buildFinanceExportHref } from '@/lib/filters';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/rbac';
import { KpiCard } from '@/components/kpi/KpiCard';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { PageHeader } from '@/components/ui/primitives';
import { Link } from '@/i18n/navigation';

export default async function PartyStatementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user, filters, scope, range } = await getPageContext(params, searchParams, 'view:finance');
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');
  const tc = await getTranslations('common');
  const canExport = can(user.role, 'export:financial');

  const report = await getPartyStatementsReport(filters, scope, range);
  const columns: Column[] = [
    { label: t('f.party') },
    { label: t('opening'), align: 'end' },
    { label: t('charges'), align: 'end' },
    { label: t('payments'), align: 'end' },
    { label: t('closing'), align: 'end' },
    { label: t('lastActivity') },
  ];
  const rowsFor = (rows: PartyStatementRow[]) =>
    rows.map((row) => [
      <Link key={row.partyId} href={`/finance/parties/${row.partyId}`} className="font-medium text-primary hover:underline">
        {row.partyName}
      </Link>,
      formatMoney(row.opening, 'IQD', locale),
      formatMoney(row.charges, 'IQD', locale),
      formatMoney(row.payments, 'IQD', locale),
      formatMoney(row.closing, 'IQD', locale),
      row.lastActivity ? formatDate(row.lastActivity, locale) : '—',
    ]);

  return (
    <>
      <BackLink href="/finance/reports" label={tr('back')} />
      <PageHeader title={t('customerSupplierStatements')} subtitle={t('statementsSubtitle')} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={t('customerStatements')} value={formatMoney(report.customerClosingTotal, 'IQD', locale)} locale={locale} />
        <KpiCard label={t('supplierStatements')} value={formatMoney(report.supplierClosingTotal, 'IQD', locale)} locale={locale} invertDelta />
        <KpiCard label={t('statementExposure')} value={formatMoney(report.customerClosingTotal + report.supplierClosingTotal, 'IQD', locale)} locale={locale} />
        <KpiCard label={t('statementParties')} value={`${report.customers.length + report.suppliers.length}`} locale={locale} />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('customerStatements')}</h3>
        <DataTable
          columns={columns}
          rows={rowsFor(report.customers)}
          exportHref={canExport ? buildFinanceExportHref('statements', filters, locale, { kind: 'customer' }) : undefined}
          exportLabel={tc('exportCsv')}
          emptyLabel={tc('noData')}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('supplierStatements')}</h3>
        <DataTable
          columns={columns}
          rows={rowsFor(report.suppliers)}
          exportHref={canExport ? buildFinanceExportHref('statements', filters, locale, { kind: 'supplier' }) : undefined}
          exportLabel={tc('exportCsv')}
          emptyLabel={tc('noData')}
        />
      </section>
    </>
  );
}
