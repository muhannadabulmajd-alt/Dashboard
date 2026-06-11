import { getTranslations } from 'next-intl/server';
import { ArrowRightLeft, Building2, ChevronRight, FileText, PackageCheck, Scale, TrendingUp, UsersRound, type LucideIcon } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { getCashFlowReport, getPartyStatementsReport, getPnlReport } from '@/server/finance/reports';
import { formatMoney } from '@/lib/money';
import { PageHeader } from '@/components/ui/primitives';
import { KpiCard } from '@/components/kpi/KpiCard';
import { BackLink } from '@/components/records/parts';
import { Link } from '@/i18n/navigation';

export default async function FinanceReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, filters, scope, range } = await getPageContext(params, searchParams, 'view:finance');
  const t = await getTranslations('finance');
  const tr = await getTranslations('records');

  const [pnl, cashFlow, statements] = await Promise.all([
    getPnlReport(filters, scope, range),
    getCashFlowReport(filters, scope, range),
    getPartyStatementsReport(filters, scope, range),
  ]);

  const cards: { href: string; key: string; Icon: LucideIcon }[] = [
    { href: '/pnl', key: 'pnlReport', Icon: TrendingUp },
    { href: '/balance-sheet', key: 'balanceSheet', Icon: Scale },
    { href: '/finance/reports/cash-flow', key: 'cashFlow', Icon: ArrowRightLeft },
    { href: '/finance/reports/product-profitability', key: 'productProfitability', Icon: PackageCheck },
    { href: '/finance/reports/branch-profitability', key: 'branchProfitability', Icon: Building2 },
    { href: '/finance/reports/statements', key: 'customerSupplierStatements', Icon: UsersRound },
  ];

  return (
    <>
      <BackLink href="/finance" label={tr('back')} />
      <PageHeader title={t('reports')} subtitle={t('reportsSubtitle')} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={t('netSales')} value={formatMoney(pnl.netSales, 'IQD', locale)} locale={locale} />
        <KpiCard label={t('operatingProfit')} value={formatMoney(pnl.operatingProfit, 'IQD', locale)} locale={locale} />
        <KpiCard label={t('netCashMovement')} value={formatMoney(cashFlow.netMovement, 'IQD', locale)} locale={locale} />
        <KpiCard label={t('statementExposure')} value={formatMoney(statements.customerClosingTotal + statements.supplierClosingTotal, 'IQD', locale)} locale={locale} />
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ href, key, Icon }) => (
          <Link
            key={key}
            href={href}
            className="group flex items-start gap-3 rounded-[var(--radius)] border bg-card p-4 hover:border-primary hover:shadow-sm"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">{t(key)}</div>
              <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{t(`reportHints.${key}`)}</div>
            </div>
            <ChevronRight className="mt-3 size-4 shrink-0 text-muted-foreground rtl:rotate-180 group-hover:text-primary" />
          </Link>
        ))}
      </div>

      <section className="rounded-[var(--radius)] border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <FileText className="size-4 text-primary" />
          {t('reportPack')}
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{t('reportPackHint')}</p>
      </section>
    </>
  );
}
