import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Plus } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney, formatNumber, formatPercent } from '@/lib/money';
import { formatDateTime } from '@/lib/dates';
import { allocateInteger, grossMargin } from '@/lib/metrics';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { KpiCard } from '@/components/kpi/KpiCard';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { RecordActions } from '@/components/records/RecordActions';
import { RecordTabs } from '@/components/records/RecordTabs';
import { archiveProductGroup, deleteProductGroup } from '@/server/records/product-groups';
import { Link } from '@/i18n/navigation';
import { getOrderStatusRoleMap } from '@/server/lists/resolver';

type Tab = 'overview' | 'variations' | 'reports' | 'activity';

export default async function ProductGroupDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:products');
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab =
    sp.tab === 'variations' || sp.tab === 'reports' || sp.tab === 'activity' ? sp.tab : 'overview';
  const t = await getTranslations('records');

  const g = await prisma.productGroup.findUnique({
    where: { id },
    include: { products: { orderBy: { sku: 'asc' } } },
  });
  if (!g) notFound();

  const name = locale === 'ar' ? g.nameAr : g.nameEn;
  const variationIds = g.products.map((p) => p.id);
  const statusRoles = await getOrderStatusRoleMap();
  const saleStatuses = [...statusRoles].filter(([, role]) => role === 'SALE').map(([code]) => code);

  // Sales rollup across this main product's variations (overview + reports).
  const lines = variationIds.length
    ? await prisma.orderLine.findMany({
        where: { productId: { in: variationIds }, order: { status: { in: saleStatuses } } },
        select: {
          id: true,
          productId: true,
          quantity: true,
          unitCogsSnapshot: true,
          order: {
            select: {
              grossAmount: true,
              discountAmount: true,
              refundAmount: true,
              lines: { select: { id: true, lineNet: true }, orderBy: { id: 'asc' } },
            },
          },
        },
        take: 20_000,
      })
    : [];
  const byVar = new Map<string, { units: number; revenue: number; cogs: number }>();
  let totalUnits = 0;
  let totalRevenue = 0;
  let totalCogs = 0;
  for (const l of lines) {
    const net = Math.max(0, l.order.grossAmount - l.order.discountAmount - l.order.refundAmount);
    const allocations = allocateInteger(net, l.order.lines.map((line) => line.lineNet));
    const lineRevenue = allocations[l.order.lines.findIndex((line) => line.id === l.id)] ?? 0;
    const row = byVar.get(l.productId) ?? { units: 0, revenue: 0, cogs: 0 };
    row.units += l.quantity;
    row.revenue += lineRevenue;
    row.cogs += l.unitCogsSnapshot * l.quantity;
    byVar.set(l.productId, row);
    totalUnits += l.quantity;
    totalRevenue += lineRevenue;
    totalCogs += l.unitCogsSnapshot * l.quantity;
  }
  const gm = grossMargin(totalRevenue, totalCogs);

  const base = `/admin/records/product-groups/${g.id}`;
  const tabs = (['overview', 'variations', 'reports', 'activity'] as const).map((k) => ({
    key: k,
    label: t(`tabs.${k}`),
    href: k === 'overview' ? base : `${base}?tab=${k}`,
  }));

  return (
    <>
      <BackLink href="/admin/records/products?view=main" label={t('back')} />
      <PageHeader title={name} subtitle={`${g.code} · ${t('mainProduct')}`} />
      <RecordActions
        editHref={`${base}/edit`}
        isActive={g.isActive}
        archiveAction={archiveProductGroup.bind(null, g.id, locale, !g.isActive)}
        deleteAction={deleteProductGroup.bind(null, g.id, locale)}
        labels={{
          edit: t('edit'),
          archive: t('archive'),
          restore: t('restore'),
          delete: t('delete'),
          confirm: t('confirmDelete'),
        }}
      />
      <RecordTabs tabs={tabs} active={tab} />

      {tab === 'overview' ? (
        <div className="space-y-4">
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label={t('rep.unitsSold')} value={formatNumber(totalUnits, locale)} locale={locale} />
            <KpiCard label={t('rep.revenue')} value={formatMoney(totalRevenue, 'IQD', locale)} locale={locale} />
            <KpiCard label={t('rep.grossMargin')} value={formatPercent(gm.pct, locale)} sub={formatMoney(gm.amount, 'IQD', locale)} locale={locale} />
            <KpiCard label={t('f.variations')} value={formatNumber(g.products.length, locale)} locale={locale} />
          </section>
          <div className="flex flex-col gap-4 sm:flex-row">
            {g.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={g.imageUrl} alt={name} className="h-32 w-32 shrink-0 rounded-[var(--radius)] border object-cover" />
            ) : null}
            <DetailGrid
              className="flex-1"
              items={[
                { label: t('f.code'), value: g.code },
                { label: t('f.name'), value: `${g.nameEn} / ${g.nameAr}` },
                { label: t('f.category'), value: enumLabel(g.productLine, locale) },
                { label: t('f.productType'), value: g.productType },
                { label: t('f.description'), value: g.description },
                {
                  label: t('f.status'),
                  value: <Badge variant={g.isActive ? 'success' : 'muted'}>{g.isActive ? t('f.active') : t('f.inactive')}</Badge>,
                } satisfies DetailField,
              ]}
            />
          </div>
        </div>
      ) : null}

      {tab === 'variations' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t('f.variations')}</h3>
            <Link
              href={`/admin/records/products/new?group=${g.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-95"
            >
              <Plus className="size-3.5" />
              {t('addVariation')}
            </Link>
          </div>
          <DataTable
            columns={[
              { label: t('f.sku') },
              { label: t('f.name') },
              { label: t('f.size') },
              { label: t('f.grind') },
              { label: t('f.price'), align: 'end' },
              { label: t('f.status') },
            ]}
            rows={g.products.map((p) => [
              <span key="s" className="font-mono text-xs text-muted-foreground">{p.sku}</span>,
              <Link key="n" href={`/admin/records/products/${p.id}`} className="font-medium text-primary hover:underline">
                {locale === 'ar' ? p.nameAr : p.nameEn}
              </Link>,
              p.sizeLabel,
              enumLabel(p.grind, locale),
              formatMoney(p.sellingPrice, p.sellingCurrency, locale),
              <Badge key="st" variant={p.isActive ? 'success' : 'muted'}>{p.isActive ? t('f.active') : t('f.inactive')}</Badge>,
            ])}
            emptyLabel={t('none')}
          />
        </div>
      ) : null}

      {tab === 'reports' ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('tabs.reports')}</h3>
          <DataTable
            columns={[
              { label: t('f.name') },
              { label: t('rep.unitsSold'), align: 'end' },
              { label: t('rep.revenue'), align: 'end' },
              { label: t('rep.cogs'), align: 'end' },
              { label: t('rep.grossMargin'), align: 'end' },
            ]}
            rows={g.products
              .map((p) => {
                const s = byVar.get(p.id) ?? { units: 0, revenue: 0, cogs: 0 };
                const m = grossMargin(s.revenue, s.cogs);
                return { p, s, m };
              })
              .sort((a, b) => b.s.revenue - a.s.revenue)
              .map(({ p, s, m }) => [
                locale === 'ar' ? p.nameAr : p.nameEn,
                formatNumber(s.units, locale),
                formatMoney(s.revenue, 'IQD', locale),
                formatMoney(s.cogs, 'IQD', locale),
                `${formatMoney(m.amount, 'IQD', locale)} · ${formatPercent(m.pct, locale)}`,
              ])}
            emptyLabel={t('none')}
          />
        </div>
      ) : null}

      {tab === 'activity' ? <ActivityTab groupId={g.id} code={g.code} variationIds={variationIds} variationSkus={g.products.map((p) => p.sku)} locale={locale} t={t} /> : null}
    </>
  );
}

/** Audit-log entries related to this main product and its variations. */
async function ActivityTab({
  groupId,
  code,
  variationIds,
  variationSkus,
  locale,
  t,
}: {
  groupId: string;
  code: string;
  variationIds: string[];
  variationSkus: string[];
  locale: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const logs = await prisma.auditLog.findMany({
    where: { entity: { in: ['Product', 'ProductGroup'] } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { name: true } } },
  });
  const ids = new Set(variationIds);
  const skus = new Set(variationSkus);
  const related = logs
    .filter((l) => {
      const m = (l.metadata ?? {}) as Record<string, unknown>;
      if (l.entity === 'ProductGroup') return m.id === groupId || m.code === code;
      return (typeof m.id === 'string' && ids.has(m.id)) || (typeof m.sku === 'string' && skus.has(m.sku));
    })
    .slice(0, 30);

  const cols: Column[] = [
    { label: t('act.when') },
    { label: t('act.action') },
    { label: t('act.by') },
  ];
  const rows = related.map((l) => [
    formatDateTime(l.createdAt, locale as 'ar' | 'en'),
    `${l.action} · ${l.entity === 'ProductGroup' ? t('mainProduct') : t('f.variation')}`,
    l.user?.name ?? '—',
  ]);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{t('tabs.activity')}</h3>
      <DataTable columns={cols} rows={rows} emptyLabel={t('none')} />
    </div>
  );
}
