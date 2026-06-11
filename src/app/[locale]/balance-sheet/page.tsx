import { getTranslations } from 'next-intl/server';
import { ArrowLeft, Download, Coffee } from 'lucide-react';
import { requireCapability } from '@/server/auth/rbac';
import { prisma } from '@/server/db/client';
import { formatMoney, convertToIqd, type AppLocale } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { accountBalance, netCash, unassignedCash, financeTotals, type FinanceEntryLike } from '@/lib/metrics/finance';
import { can } from '@/lib/rbac';
import { getUsdToIqd } from '@/server/settings';
import { PrintButton } from '@/components/PrintButton';
import { SectionGuide } from '@/components/records/SectionGuide';

function BalanceRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 py-1 ${strong ? 'border-t font-bold' : 'text-sm'}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export default async function BalanceSheetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireCapability(locale, 'view:finance');
  const t = await getTranslations('finance');
  const loc = locale as AppLocale;
  const canExport = can(user.role, 'export:financial');

  const [accounts, entriesRaw, inventoryItems] = await Promise.all([
    prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.financeEntry.findMany({
      where: { reversedAt: null, reversalOfId: null },
      select: {
        id: true, type: true, amount: true, currency: true, obligation: true,
        obligationKind: true, accountId: true, toAccountId: true, settlesId: true,
      },
    }),
    prisma.inventoryItem.findMany({
      select: {
        unitCost: true,
        movements: { select: { quantity: true } },
      },
    }),
  ]);
  const entries = entriesRaw as FinanceEntryLike[];
  const currencies = Array.from(new Set([...accounts.map((a) => a.currency), ...entries.map((e) => e.currency)]));
  if (!currencies.length) currencies.push('IQD');

  const rate = await getUsdToIqd();
  const inventoryValue = inventoryItems.reduce(
    (s, item) => s + (item.unitCost ?? 0) * item.movements.reduce((sum, m) => sum + m.quantity, 0),
    0,
  );
  const comb = { cashBank: 0, receivables: 0, payables: 0, capital: 0, inventory: inventoryValue };
  for (const cur of currencies) {
    const ce = entries.filter((e) => e.currency === cur);
    const ca = accounts.filter((a) => a.currency === cur);
    const tot = financeTotals(ce);
    const cashBank = netCash(ca, ce);
    comb.cashBank += convertToIqd(cashBank, cur, rate);
    comb.receivables += convertToIqd(tot.outstandingReceivable, cur, rate);
    comb.payables += convertToIqd(tot.outstandingPayable, cur, rate);
    comb.capital += convertToIqd(tot.capitalIn, cur, rate);
  }
  const combAssets = comb.cashBank + comb.receivables + comb.inventory;
  const combRetained = combAssets - comb.payables - comb.capital;
  const showCombined = currencies.length > 1;
  const iqd = (n: number) => formatMoney(n, 'IQD', loc);

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto flex max-w-[820px] flex-wrap items-center justify-between gap-2 px-4 py-3 print:hidden">
        <a href={`/${locale}/finance`} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {t('title')}
        </a>
        <div className="flex items-center gap-2">
          {canExport ? (
            <a
              href={`/api/finance/export?type=balances&locale=${locale}`}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              <Download className="size-4" />
              CSV
            </a>
          ) : null}
          <PrintButton label={t('print')} />
        </div>
      </div>

      <div className="mx-auto max-w-[820px] px-4 print:hidden">
        <SectionGuide
          title={t('guide.balanceSheet.title')}
          intro={t('guide.balanceSheet.intro')}
          points={t.raw('guide.balanceSheet.points')}
        />
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

        {showCombined ? (
          <div className="mt-6 rounded-lg border bg-muted/20 p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-primary">{t('allInIqd')}</div>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-sm font-semibold text-primary">{t('assets')}</div>
                <BalanceRow label={t('cashBank')} value={iqd(comb.cashBank)} />
                <BalanceRow label={t('receivables')} value={iqd(comb.receivables)} />
                <BalanceRow label={t('inventoryValue')} value={iqd(comb.inventory)} />
                <BalanceRow label={t('totalAssets')} value={iqd(combAssets)} strong />
              </div>
              <div>
                <div className="mb-1 text-sm font-semibold text-primary">{t('liabilities')}</div>
                <BalanceRow label={t('payables')} value={iqd(comb.payables)} />
                <div className="mb-1 mt-4 text-sm font-semibold text-primary">{t('equity')}</div>
                <BalanceRow label={t('capital')} value={iqd(comb.capital)} />
                <BalanceRow label={t('retained')} value={iqd(combRetained)} />
                <BalanceRow label={t('totalEquity')} value={iqd(comb.capital + combRetained)} strong />
              </div>
            </div>
          </div>
        ) : null}

        {currencies.map((cur) => {
          const ce = entries.filter((e) => e.currency === cur);
          const ca = accounts.filter((a) => a.currency === cur);
          const tot = financeTotals(ce);
          const cashBank = netCash(ca, ce);
          const unassigned = unassignedCash(ce);
          const totalAssets = cashBank + tot.outstandingReceivable + (cur === 'IQD' ? inventoryValue : 0);
          const retained = totalAssets - tot.outstandingPayable - tot.capitalIn;
          const m = (n: number) => formatMoney(n, cur, loc);
          return (
            <div key={cur} className="mt-6">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{cur}</div>
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-sm font-semibold text-primary">{t('assets')}</div>
                  <BalanceRow label={t('cashBank')} value={m(cashBank)} />
                  <BalanceRow label={t('receivables')} value={m(tot.outstandingReceivable)} />
                  {cur === 'IQD' ? <BalanceRow label={t('inventoryValue')} value={m(inventoryValue)} /> : null}
                  <BalanceRow label={t('totalAssets')} value={m(totalAssets)} strong />
                  {ca.length || unassigned ? (
                    <div className="mt-3 space-y-0.5 text-xs text-muted-foreground">
                      {ca.map((a) => (
                        <div key={a.id} className="flex justify-between gap-4">
                          <span>{a.name}</span>
                          <span className="tabular-nums">{m(accountBalance(a, ce))}</span>
                        </div>
                      ))}
                      {unassigned ? (
                        <div className="flex justify-between gap-4">
                          <span>{t('unassigned')}</span>
                          <span className="tabular-nums">{m(unassigned)}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div>
                  <div className="mb-1 text-sm font-semibold text-primary">{t('liabilities')}</div>
                  <BalanceRow label={t('payables')} value={m(tot.outstandingPayable)} />
                  <BalanceRow label={t('totalLiabilities')} value={m(tot.outstandingPayable)} strong />
                  <div className="mb-1 mt-4 text-sm font-semibold text-primary">{t('equity')}</div>
                  <BalanceRow label={t('capital')} value={m(tot.capitalIn)} />
                  <BalanceRow label={t('retained')} value={m(retained)} />
                  <BalanceRow label={t('totalEquity')} value={m(tot.capitalIn + retained)} strong />
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
