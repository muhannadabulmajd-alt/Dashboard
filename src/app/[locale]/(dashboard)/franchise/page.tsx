import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getBranchPerformance } from '@/server/db/repositories/franchise.repo';
import * as M from '@/lib/metrics';
import { formatMoney, formatNumber, formatPercent } from '@/lib/money';
import { KpiCard } from '@/components/kpi/KpiCard';
import { BarChartCard } from '@/components/charts/Charts';
import { Badge, PageHeader, Card, CardContent } from '@/components/ui/primitives';

function scoreClasses(score: number): string {
  if (score >= 70) return 'text-success';
  if (score >= 40) return 'text-warning';
  return 'text-danger';
}
function barColor(score: number): string {
  if (score >= 70) return 'bg-success';
  if (score >= 40) return 'bg-warning';
  return 'bg-danger';
}

export default async function FranchisePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, filters, scope, range } = await getPageContext(params, searchParams, 'view:franchise');
  const t = await getTranslations('franchise');

  const perf = await getBranchPerformance(filters, scope, range);
  const rows = perf.map((b) => ({
    b,
    readiness: M.franchiseReadinessScore({ netSales: b.netSales, marginPct: b.marginPct, orders: b.orders }),
  }));

  const totalNet = perf.reduce((s, b) => s + b.netSales, 0);
  const totalCogs = perf.reduce((s, b) => s + b.cogs, 0);
  const avgMargin = totalNet > 0 ? (totalNet - totalCogs) / totalNet : 0;
  const avgReadiness = rows.length ? Math.round(rows.reduce((s, r) => s + r.readiness.score, 0) / rows.length) : 0;

  const name = (b: (typeof perf)[number]) => (locale === 'ar' ? b.nameAr : b.nameEn);
  const comparison = perf.map((b) => ({ label: name(b), value: b.netSales }));
  const partLabel: Record<string, string> = {
    sales: t('salesScore'),
    margin: t('marginScore'),
    orders: t('ordersScore'),
  };

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={t('branches')} value={formatNumber(perf.length, locale)} locale={locale} />
        <KpiCard label={t('totalSales')} value={formatMoney(totalNet, 'IQD', locale)} locale={locale} />
        <KpiCard label={t('avgMargin')} value={formatPercent(avgMargin, locale)} locale={locale} />
        <KpiCard label={t('avgReadiness')} value={`${avgReadiness}/100`} locale={locale} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {rows.map(({ b, readiness }) => (
          <Card key={b.id}>
            <CardContent className="space-y-3 pt-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold">{name(b)}</div>
                  <div className="text-xs text-muted-foreground">{b.code}</div>
                </div>
                <Badge variant={b.isFranchise ? 'default' : 'muted'}>
                  {b.isFranchise ? t('franchiseTag') : t('hq')}
                </Badge>
              </div>

              <div className="flex items-end justify-between">
                <span className="text-xs text-muted-foreground">{t('readiness')}</span>
                <span className={`text-2xl font-bold tabular ${scoreClasses(readiness.score)}`}>
                  {readiness.score}
                  <span className="text-sm text-muted-foreground">/100</span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full ${barColor(readiness.score)}`} style={{ width: `${readiness.score}%` }} />
              </div>

              <div className="space-y-1.5">
                {readiness.parts.map((p) => (
                  <div key={p.key} className="flex items-center gap-2">
                    <span className="w-12 text-[11px] text-muted-foreground">{partLabel[p.key]}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full ${barColor(p.score)}`} style={{ width: `${p.score}%` }} />
                    </div>
                    <span className="w-8 text-end text-[11px] tabular text-muted-foreground">{p.score}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-2 border-t pt-2 text-xs sm:grid-cols-2">
                <div>
                  <div className="text-muted-foreground">{t('netSales')}</div>
                  <div className="font-semibold tabular">{formatMoney(b.netSales, 'IQD', locale)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t('margin')}</div>
                  <div className="font-semibold tabular">{formatPercent(b.marginPct, locale)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t('orders')}</div>
                  <div className="font-semibold tabular">{formatNumber(b.orders, locale)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t('customers')}</div>
                  <div className="font-semibold tabular">{formatNumber(b.customers, locale)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section>
        <BarChartCard title={t('comparison')} data={comparison} locale={locale} valueKind="iqd" horizontal />
      </section>
    </>
  );
}
