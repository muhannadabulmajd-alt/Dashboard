import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getInventoryItems } from '@/server/db/repositories/inventory.repo';
import * as M from '@/lib/metrics';
import { enumLabel } from '@/lib/enums';
import { buildExportHref } from '@/lib/filters';
import { formatMoney, formatNumber, formatQuantity } from '@/lib/money';
import { KpiCard } from '@/components/kpi/KpiCard';
import { BarChartCard, DonutChartCard } from '@/components/charts/Charts';
import { DataTable } from '@/components/data-table/DataTable';
import { Badge, PageHeader } from '@/components/ui/primitives';

export default async function InventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, filters, scope, range } = await getPageContext(params, searchParams, 'view:inventory');
  const t = await getTranslations('inventory');
  const tk = await getTranslations('kpi');
  const tt = await getTranslations('table');
  const tc = await getTranslations('common');

  const items = await getInventoryItems(filters, scope, range);
  const rows = items.map((it) => ({ it, row: M.stockRow(it), oc: M.openingClosing(it.movements, range.start, range.end) }));

  const name = (it: (typeof items)[number]) => (locale === 'ar' ? it.nameAr : it.nameEn);

  const totalValue = rows.reduce((s, r) => s + r.row.value, 0);
  const reorder = M.reorderAlerts(items);
  const expiry = M.nearExpiry(items, 21);
  const coverages = rows.map((r) => r.row.coverageDays).filter((c): c is number => c != null);
  const avgCoverage = coverages.length ? coverages.reduce((a, b) => a + b, 0) / coverages.length : 0;

  const byCategory = M.stockValueByCategory(items).map((c) => ({
    label: enumLabel(c.category, locale),
    value: c.value,
  }));
  const coverageData = rows
    .filter((r) => r.row.coverageDays != null)
    .map((r) => ({ label: name(r.it), value: Math.round(r.row.coverageDays!) }));

  const ledgerCols = [
    { label: t('item') },
    { label: t('category') },
    { label: t('opening'), align: 'end' as const },
    { label: t('additions'), align: 'end' as const },
    { label: t('deductions'), align: 'end' as const },
    { label: t('current'), align: 'end' as const },
    { label: t('coverageDays'), align: 'end' as const },
  ];
  const ledgerRows = rows.map((r) => [
    name(r.it),
    enumLabel(r.it.category, locale),
    `${formatQuantity(r.oc.opening, locale)} ${r.it.unit}`,
    formatQuantity(r.oc.additions, locale),
    formatQuantity(r.oc.deductions, locale),
    <span key="c" className={r.row.belowReorder ? 'font-semibold text-danger' : ''}>
      {formatQuantity(r.row.current, locale)} {r.it.unit}
    </span>,
    r.row.coverageDays == null ? '—' : formatNumber(Math.round(r.row.coverageDays), locale),
  ]);

  const expiryCols = [
    { label: t('item') },
    { label: t('daysToExpiry'), align: 'end' as const },
    { label: tt('qty'), align: 'end' as const },
  ];
  const expiryRows = expiry.map((e) => [
    name(e.item),
    formatNumber(e.daysToExpiry, locale),
    `${formatQuantity(e.quantity, locale)} ${e.item.unit}`,
  ]);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={tk('stockValue')} value={formatMoney(totalValue, 'IQD', locale)} locale={locale} />
        <KpiCard label={tk('reorderAlerts')} value={formatNumber(reorder.length, locale)} locale={locale} invertDelta />
        <KpiCard label={tk('nearExpiry')} value={formatNumber(expiry.length, locale)} locale={locale} invertDelta />
        <KpiCard label={tk('avgCoverage')} value={tk('days', { count: formatNumber(Math.round(avgCoverage), locale) })} locale={locale} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <DonutChartCard title={t('stockByCategory')} data={byCategory} locale={locale} valueKind="iqd" />
        <BarChartCard title={t('coverage')} data={coverageData} locale={locale} valueKind="count" horizontal />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t('ledger')}</h3>
        </div>
        <DataTable
          columns={ledgerCols}
          rows={ledgerRows}
          exportHref={buildExportHref('inventory', filters, locale)}
          exportLabel={tc('exportCsv')}
          emptyLabel={tc('noData')}
        />
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{t('expiryList')}</h3>
          <Badge variant={expiry.length ? 'danger' : 'success'}>{formatNumber(expiry.length, locale)}</Badge>
        </div>
        <DataTable columns={expiryCols} rows={expiryRows} emptyLabel={tc('noData')} />
      </section>
    </>
  );
}
