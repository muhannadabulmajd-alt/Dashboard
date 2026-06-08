import { getTranslations } from 'next-intl/server';
import { ArrowLeft, Download, Coffee } from 'lucide-react';
import { requireCapability } from '@/server/auth/rbac';
import { prisma } from '@/server/db/client';
import { formatMoney, type AppLocale } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { accountBalance, financeTotals, type FinanceEntryLike } from '@/lib/metrics/finance';
import { PrintButton } from '@/components/PrintButton';

export default async function BalanceSheetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireCapability(locale, 'view:finance');
  const t = await getTranslations('finance');
  const loc = locale as AppLocale;

  const [accounts, entriesRaw] = await Promise.all([
    prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.financeEntry.findMany({
      select: {
        id: true, type: true, amount: true, currency: true, obligation: true,
        obligationKind: true, accountId: true, toAccountId: true, settlesId: true,
      },
    }),
  ]);
  const entries = entriesRaw as FinanceEntryLike[];
  const currencies = Array.from(new Set([...accounts.map((a) => a.currency), ...entries.map((e) => e.currency)]));
  if (!currencies.length) currencies.push('IQD');

  const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div className={`flex justify-between gap-6 py-1 ${strong ? 'border-t font-bold' : 'text-sm'}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto flex max-w-[820px] flex-wrap items-center justify-between gap-2 px-4 py-3 print:hidden">
        <a href={`/${locale}/finance`} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {t('title')}
        </a>
        <div className="flex items-center gap-2">
          <a
            href={`/api/finance/export?type=balances&locale=${locale}`}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <Download className="size-4" />
            CSV
          </a>
          <PrintButton label={t('print')} />
        </div>
      </div>

      <div className="invoice-paper mx-auto my-2 max-w-[820px] bg-card p-8 shadow-sm print:my-0 print:max-w-none print:shadow-none">
        <div className="flex items-center justify-between border-b pb-5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Coffee className="size-5" />
            </div>
            <div className="text-lg font-bold">{t('balanceSheet')}</div>
          </div>
          <div className="text-sm text-muted-foreground">{t('asOf', { date: formatDate(new Date(), loc) })}</div>
        </div>

        {currencies.map((cur) => {
          const ce = entries.filter((e) => e.currency === cur);
          const ca = accounts.filter((a) => a.currency === cur);
          const tot = financeTotals(ce);
          const cashBank = ca.reduce((s, a) => s + accountBalance(a, ce), 0);
          const totalAssets = cashBank + tot.outstandingReceivable;
          const retained = totalAssets - tot.outstandingPayable - tot.capitalIn;
          const m = (n: number) => formatMoney(n, cur, loc);
          return (
            <div key={cur} className="mt-6">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{cur}</div>
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-sm font-semibold text-primary">{t('assets')}</div>
                  <Row label={t('cashBank')} value={m(cashBank)} />
                  <Row label={t('receivables')} value={m(tot.outstandingReceivable)} />
                  <Row label={t('totalAssets')} value={m(totalAssets)} strong />
                  {ca.length ? (
                    <div className="mt-3 space-y-0.5 text-xs text-muted-foreground">
                      {ca.map((a) => (
                        <div key={a.id} className="flex justify-between gap-4">
                          <span>{a.name}</span>
                          <span className="tabular-nums">{m(accountBalance(a, ce))}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div>
                  <div className="mb-1 text-sm font-semibold text-primary">{t('liabilities')}</div>
                  <Row label={t('payables')} value={m(tot.outstandingPayable)} />
                  <Row label={t('totalLiabilities')} value={m(tot.outstandingPayable)} strong />
                  <div className="mb-1 mt-4 text-sm font-semibold text-primary">{t('equity')}</div>
                  <Row label={t('capital')} value={m(tot.capitalIn)} />
                  <Row label={t('retained')} value={m(retained)} />
                  <Row label={t('totalEquity')} value={m(tot.capitalIn + retained)} strong />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <style>{`@media print { body { background: #fff !important; } .invoice-paper { padding: 0 !important; } }`}</style>
    </div>
  );
}
