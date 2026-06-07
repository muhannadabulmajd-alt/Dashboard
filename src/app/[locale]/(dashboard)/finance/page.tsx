import { getTranslations } from 'next-intl/server';
import { Wallet, Users, BookOpen, Plus, ChevronRight, Clock, PieChart } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/rbac';
import { accountBalance, financeTotals, type FinanceEntryLike } from '@/lib/metrics/finance';
import { PageHeader } from '@/components/ui/primitives';
import { KpiCard } from '@/components/kpi/KpiCard';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { Link } from '@/i18n/navigation';

export default async function FinancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'view:finance');
  const t = await getTranslations('finance');
  const canManage = can(user.role, 'manage:finance');

  const [accounts, entriesRaw] = await Promise.all([
    prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }),
    prisma.financeEntry.findMany({
      select: {
        id: true, type: true, amount: true, currency: true, obligation: true,
        obligationKind: true, accountId: true, toAccountId: true, settlesId: true,
      },
    }),
  ]);
  const entries = entriesRaw as FinanceEntryLike[];

  const currencies = Array.from(new Set([...accounts.map((a) => a.currency), ...entries.map((e) => e.currency)]));
  if (currencies.length === 0) currencies.push('IQD');

  const accCols: Column[] = [
    { label: t('f.name') },
    { label: t('f.type') },
    { label: t('f.balance'), align: 'end' },
  ];

  const cards = [
    { href: '/finance/accounts', key: 'accounts', Icon: Wallet },
    { href: '/finance/parties', key: 'parties', Icon: Users },
    { href: '/finance/ledger', key: 'ledger', Icon: BookOpen },
    { href: '/finance/dues', key: 'dues', Icon: Clock },
    { href: '/finance/shareholders', key: 'shareholders', Icon: PieChart },
  ];

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        {canManage ? (
          <Link
            href="/finance/ledger/new"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
          >
            <Plus className="size-4" />
            {t('recordEntry')}
          </Link>
        ) : null}
      </div>

      {currencies.map((cur) => {
        const ce = entries.filter((e) => e.currency === cur);
        const ca = accounts.filter((a) => a.currency === cur);
        const tot = financeTotals(ce);
        const cash = ca.reduce((s, a) => s + accountBalance(a, ce), 0);
        return (
          <section key={cur} className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">{cur}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <KpiCard locale={locale} label={t('cashOnHand')} value={formatMoney(cash, cur, locale)} />
              <KpiCard locale={locale} label={t('capital')} value={formatMoney(tot.capitalIn, cur, locale)} />
              <KpiCard locale={locale} label={t('spent')} value={formatMoney(tot.expenses, cur, locale)} />
              <KpiCard locale={locale} label={t('received')} value={formatMoney(tot.received, cur, locale)} />
              <KpiCard locale={locale} label={t('payables')} value={formatMoney(tot.outstandingPayable, cur, locale)} />
              <KpiCard locale={locale} label={t('receivables')} value={formatMoney(tot.outstandingReceivable, cur, locale)} />
            </div>
            {ca.length ? (
              <DataTable
                columns={accCols}
                rows={ca.map((a) => [
                  a.name,
                  enumLabel(a.type, locale),
                  formatMoney(accountBalance(a, ce), cur, locale),
                ])}
                emptyLabel="—"
              />
            ) : null}
          </section>
        );
      })}

      {(
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ href, key, Icon }) => (
            <Link
              key={key}
              href={href}
              className="group flex items-center gap-3 rounded-[var(--radius)] border bg-card p-4 hover:border-primary hover:shadow-sm"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground">{t(key)}</div>
                <div className="truncate text-xs text-muted-foreground">{t(`entityHints.${key}`)}</div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
