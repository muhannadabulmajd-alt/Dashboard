import { getTranslations } from 'next-intl/server';
import { ArrowLeft, Download, Coffee } from 'lucide-react';
import { requireCapability } from '@/server/auth/rbac';
import { formatMoney, type AppLocale } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { can } from '@/lib/rbac';
import { buildBranchScope } from '@/server/filters/where-builder';
import { getBalanceSheetSnapshot } from '@/server/finance/balance-sheet';
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

  const snapshot = await getBalanceSheetSnapshot({ scope: buildBranchScope(user) });
  const comb = snapshot.combinedIqd;
  const showCombined = snapshot.currencies.length > 1;
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
                <BalanceRow label={t('fixedAssets')} value={iqd(comb.fixedAssets)} />
                <BalanceRow label={t('totalAssets')} value={iqd(comb.totalAssets)} strong />
              </div>
              <div>
                <div className="mb-1 text-sm font-semibold text-primary">{t('liabilities')}</div>
                <BalanceRow label={t('payables')} value={iqd(comb.payables)} />
                <div className="mb-1 mt-4 text-sm font-semibold text-primary">{t('equity')}</div>
                <BalanceRow label={t('capital')} value={iqd(comb.capital)} />
                <BalanceRow label={t('retained')} value={iqd(comb.retained)} />
                <BalanceRow label={t('totalEquity')} value={iqd(comb.totalEquity)} strong />
              </div>
            </div>
          </div>
        ) : null}

        {snapshot.currencies.map((row) => {
          const m = (n: number) => formatMoney(n, row.currency, loc);
          return (
            <div key={row.currency} className="mt-6">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{row.currency}</div>
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-sm font-semibold text-primary">{t('assets')}</div>
                  <BalanceRow label={t('cashBank')} value={m(row.cashBank)} />
                  <BalanceRow label={t('receivables')} value={m(row.receivables)} />
                  {row.inventory ? <BalanceRow label={t('inventoryValue')} value={m(row.inventory)} /> : null}
                  {row.fixedAssets ? <BalanceRow label={t('fixedAssets')} value={m(row.fixedAssets)} /> : null}
                  {row.currency === 'IQD' && !row.inventory ? <BalanceRow label={t('inventoryValue')} value={m(0)} /> : null}
                  {row.currency === 'IQD' && !row.fixedAssets ? <BalanceRow label={t('fixedAssets')} value={m(0)} /> : null}
                  <BalanceRow label={t('totalAssets')} value={m(row.totalAssets)} strong />
                  {row.accounts.length || row.unassignedCash ? (
                    <div className="mt-3 space-y-0.5 text-xs text-muted-foreground">
                      {row.accounts.map((account) => (
                        <div key={account.id} className="flex justify-between gap-4">
                          <span>{account.name}</span>
                          <span className="tabular-nums">{m(account.balance)}</span>
                        </div>
                      ))}
                      {row.unassignedCash ? (
                        <div className="flex justify-between gap-4">
                          <span>{t('unassigned')}</span>
                          <span className="tabular-nums">{m(row.unassignedCash)}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div>
                  <div className="mb-1 text-sm font-semibold text-primary">{t('liabilities')}</div>
                  <BalanceRow label={t('payables')} value={m(row.payables)} />
                  <BalanceRow label={t('totalLiabilities')} value={m(row.payables)} strong />
                  <div className="mb-1 mt-4 text-sm font-semibold text-primary">{t('equity')}</div>
                  <BalanceRow label={t('capital')} value={m(row.capital)} />
                  <BalanceRow label={t('retained')} value={m(row.retained)} />
                  <BalanceRow label={t('totalEquity')} value={m(row.totalEquity)} strong />
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
