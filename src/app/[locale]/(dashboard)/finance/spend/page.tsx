import { getTranslations } from 'next-intl/server';
import { Search } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { enumLabel } from '@/lib/enums';
import { formatDate } from '@/lib/dates';
import { buildFinanceExportHref } from '@/lib/filters';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/rbac';
import { getSpendRows, type SpendBucket } from '@/server/finance/spend';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { KpiCard } from '@/components/kpi/KpiCard';
import { DrilldownBanner } from '@/components/insights/DrilldownBanner';
import { BackLink } from '@/components/records/parts';
import { PageHeader } from '@/components/ui/primitives';
import { Link } from '@/i18n/navigation';

const BUCKETS: SpendBucket[] = ['all', 'capex', 'inventory', 'opex', 'direct', 'cogs'];

function bucketFrom(value: string | string[] | undefined): SpendBucket {
  const raw = Array.isArray(value) ? value[0] : value;
  return BUCKETS.includes(raw as SpendBucket) ? (raw as SpendBucket) : 'all';
}

export default async function FinanceSpendPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user, filters, scope, range } = await getPageContext(params, searchParams, 'view:finance');
  const sp = await searchParams;
  const t = await getTranslations('finance');
  const tc = await getTranslations('common');
  const bucket = bucketFrom(sp.bucket);
  const rowFilters = {
    category: typeof sp.category === 'string' ? sp.category : undefined,
    month: typeof sp.month === 'string' ? sp.month : undefined,
    party: typeof sp.party === 'string' ? sp.party : undefined,
    q: typeof sp.q === 'string' ? sp.q : undefined,
  };
  const rows = await getSpendRows(bucket, filters, scope, range, rowFilters);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const canExport = can(user.role, 'export:financial');

  const columns: Column[] = [
    { label: t('f.date') },
    { label: t('f.description') },
    { label: t('f.category') },
    { label: t('f.party') },
    { label: t('f.reference') },
    { label: t('f.amount'), align: 'end' },
  ];
  const tableRows = rows.map((row) => [
    formatDate(row.date, locale),
    row.sourceHref ? <Link href={row.sourceHref}>{row.description}</Link> : row.description,
    row.bucket === 'cogs' ? row.category : enumLabel(row.category, locale),
    row.party ?? '—',
    row.reference ?? '—',
    formatMoney(row.amount, 'IQD', locale),
  ]);

  const activeFilters = [rowFilters.month, rowFilters.category, rowFilters.party, rowFilters.q].filter(Boolean).join(' · ');
  const activeChips = [
    `${t('spendBuckets.' + bucket)}`,
    rowFilters.month ? `${locale === 'ar' ? 'الشهر' : 'Month'}: ${rowFilters.month}` : null,
    rowFilters.category ? `${locale === 'ar' ? 'التصنيف' : 'Category'}: ${rowFilters.category}` : null,
    rowFilters.party ? `${locale === 'ar' ? 'الجهة' : 'Party'}: ${rowFilters.party}` : null,
    rowFilters.q ? `${locale === 'ar' ? 'بحث' : 'Search'}: ${rowFilters.q}` : null,
  ].filter(Boolean) as string[];
  const exportHref = buildFinanceExportHref('spend', filters, locale, {
    bucket,
    month: rowFilters.month,
    category: rowFilters.category,
    party: rowFilters.party,
    q: rowFilters.q,
  });

  return (
    <>
      <BackLink href="/finance" label={t('title')} />
      <PageHeader
        title={t(`spendBuckets.${bucket}`)}
        subtitle={activeFilters || t('spendDetailSubtitle')}
      />
      <DrilldownBanner
        title={locale === 'ar' ? 'نتيجة مفلترة' : 'Filtered result'}
        description={locale === 'ar' ? 'هذه القائمة تعرض البنود المطابقة لما ضغطت عليه في البطاقة أو الرسم.' : 'This page shows the rows behind the card or chart item you opened.'}
        chips={activeChips}
        totalLabel={t('total')}
        totalValue={formatMoney(total, 'IQD', locale)}
        rowsLabel={t('rows')}
        rowsValue={rows.length}
        backHref="/finance"
        backLabel={locale === 'ar' ? 'العودة للمالية' : 'Back to finance'}
        clearHref={`/finance/spend?bucket=${bucket}`}
        clearLabel={locale === 'ar' ? 'مسح الفلاتر' : 'Clear filters'}
      />
      <section className="grid gap-3 sm:grid-cols-3">
        <KpiCard label={t('total')} value={formatMoney(total, 'IQD', locale)} locale={locale} />
        <KpiCard label={t('rows')} value={`${rows.length}`} locale={locale} />
        <KpiCard label={t('timeframe')} value={`${formatDate(range.start, locale)} - ${formatDate(range.end, locale)}`} locale={locale} />
      </section>
      <form className="flex flex-wrap items-end gap-2 rounded-[var(--radius)] border bg-card p-3">
        <input type="hidden" name="bucket" value={bucket} />
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('searchRows')}
          <span className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              defaultValue={rowFilters.q ?? ''}
              className="w-full rounded-lg border bg-background py-2 pe-3 ps-9 text-sm outline-none focus:border-primary"
            />
          </span>
        </label>
        <button className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
          {t('apply')}
        </button>
      </form>
      <DataTable
        columns={columns}
        rows={tableRows}
        exportHref={canExport ? exportHref : undefined}
        exportLabel={tc('exportCsv')}
        emptyLabel={tc('noData')}
      />
    </>
  );
}
