import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Barcode, Plus } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { getListOptions } from '@/server/lists/resolver';
import { formatMoney, formatNumber, formatQuantity, type AppLocale } from '@/lib/money';
import { decimalNumber, type DecimalLike } from '@/lib/decimal';
import { formatDate, formatDateTime, dateInputValue } from '@/lib/dates';
import { productionCapacity } from '@/lib/metrics/inventory';
import { effectivePrice, scheduledPrices } from '@/lib/metrics/pricing';
import { marginStatus, type MarginStatus } from '@/lib/metrics/margin';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/data-table/DataTable';
import { BackLink, DetailGrid, type DetailField } from '@/components/records/parts';
import { RecordActions } from '@/components/records/RecordActions';
import { RecordTabs } from '@/components/records/RecordTabs';
import { OrderUsageForm } from '@/components/records/OrderUsageForm';
import { AddPriceForm } from '@/components/records/AddPriceForm';
import { ConfirmButton } from '@/components/records/RecordActions';
import { archiveProduct, deleteProduct } from '@/server/records/products';
import { deleteProductPrice } from '@/server/records/product-prices';
import { Link } from '@/i18n/navigation';

type Tab = 'overview' | 'pricing' | 'cost' | 'inventory' | 'usage' | 'activity';
const MARGIN_BADGE: Record<MarginStatus, 'success' | 'warning' | 'danger'> = { ok: 'success', lowMargin: 'warning', belowCost: 'danger' };

export default async function ProductDetailPage({
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
    sp.tab === 'pricing' || sp.tab === 'cost' || sp.tab === 'inventory' || sp.tab === 'usage' || sp.tab === 'activity'
      ? sp.tab
      : 'overview';
  const t = await getTranslations('records');
  const unitOptions = await getListOptions('unit', locale);

  const p = await prisma.product.findUnique({
    where: { id },
    include: {
      group: true,
      components: { select: { id: true, inventoryItemId: true, quantity: true, name: true, unitCost: true } },
      prices: { orderBy: { effectiveFrom: 'desc' } },
      inventoryItems: { select: { id: true, nameEn: true, nameAr: true, unit: true, unitCost: true, reorderPoint: true } },
    },
  });
  if (!p) notFound();

  const name = locale === 'ar' ? p.nameAr : p.nameEn;
  const now = new Date();
  const price = effectivePrice(p.prices, p.sellingPrice, now);
  const mStatus = marginStatus(price, p.cogsPerUnit);

  // Stock for both component items (capacity) and linked finished-goods items.
  const stockIds = [
    ...p.components.map((c) => c.inventoryItemId).filter((x): x is string => Boolean(x)),
    ...p.inventoryItems.map((i) => i.id),
  ];
  const stockRows = stockIds.length
    ? await prisma.stockMovement.groupBy({ by: ['inventoryItemId'], where: { inventoryItemId: { in: stockIds } }, _sum: { quantity: true } })
    : [];
  const stockByItem = new Map(stockRows.map((s) => [s.inventoryItemId, decimalNumber(s._sum.quantity)]));
  const capacity = productionCapacity(
    p.components.map((c) => ({ inventoryItemId: c.inventoryItemId, quantity: decimalNumber(c.quantity) })),
    stockByItem,
  );
  const limitingName = capacity.limiting ? (p.components.find((c) => c.inventoryItemId === capacity.limiting)?.name ?? '') : '';

  const base = `/admin/records/products/${p.id}`;
  const tabs = (['overview', 'pricing', 'cost', 'inventory', 'usage', 'activity'] as const).map((k) => ({
    key: k,
    label: t(`tabs.${k === 'cost' ? 'costRecipe' : k === 'usage' ? 'orderUsage' : k}`),
    href: k === 'overview' ? base : `${base}?tab=${k}`,
  }));

  return (
    <>
      <BackLink href={p.group ? `/admin/records/product-groups/${p.groupId}?tab=variations` : '/admin/records/products?view=variations'} label={t('back')} />
      <PageHeader title={name} subtitle={p.sku} />
      <RecordActions
        editHref={`${base}/edit`}
        isActive={p.isActive}
        archiveAction={archiveProduct.bind(null, p.id, locale, !p.isActive)}
        deleteAction={deleteProduct.bind(null, p.id, locale)}
        labels={{ edit: t('edit'), archive: t('archive'), restore: t('restore'), delete: t('delete'), confirm: t('confirmDelete') }}
      >
        <Link href={`${base}/label`} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted">
          <Barcode className="size-3.5" />
          {t('label.action')}
        </Link>
      </RecordActions>
      <RecordTabs tabs={tabs} active={tab} />

      {tab === 'overview' ? (
        <div className="flex flex-col gap-4 sm:flex-row">
          {p.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imageUrl} alt={name} className="h-32 w-32 shrink-0 rounded-[var(--radius)] border object-cover" />
          ) : null}
          <DetailGrid
            className="flex-1"
            items={
              [
                { label: t('f.sku'), value: p.sku },
                { label: t('f.retailBarcode'), value: <span className="font-mono" dir="ltr">{p.retailBarcode}</span> },
                { label: t('f.name'), value: `${p.nameEn} / ${p.nameAr}` },
                { label: t('f.mainProduct'), value: p.group ? `${p.group.code} · ${locale === 'ar' ? p.group.nameAr : p.group.nameEn}` : '—' },
                { label: t('f.variationType'), value: p.variationType },
                { label: t('f.size'), value: p.sizeLabel },
                { label: t('f.grind'), value: enumLabel(p.grind, locale) },
                { label: t('f.roastLevel'), value: p.roastLevel ? enumLabel(p.roastLevel, locale) : '—' },
                { label: t('f.origin'), value: p.origin },
                { label: t('f.price'), value: formatMoney(price, p.sellingCurrency, locale) },
                { label: t('f.cost'), value: formatMoney(p.cogsPerUnit, p.sellingCurrency, locale) },
                {
                  label: t('rep.grossMargin'),
                  value: <Badge variant={MARGIN_BADGE[mStatus]}>{t(`marginStatus.${mStatus}`)}</Badge>,
                },
                {
                  label: t('capacity'),
                  value:
                    capacity.producible == null
                      ? '—'
                      : capacity.producible > 0 && limitingName
                        ? `${formatNumber(capacity.producible, locale)} · ${t('limitedBy', { name: limitingName })}`
                        : formatNumber(capacity.producible, locale),
                },
                { label: t('f.status'), value: <Badge variant={p.isActive ? 'success' : 'muted'}>{p.isActive ? t('f.active') : t('f.inactive')}</Badge> },
              ] satisfies DetailField[]
            }
          />
        </div>
      ) : null}

      {tab === 'pricing' ? (
        <PricingTab product={p} price={price} now={now} locale={locale} t={t} />
      ) : null}

      {tab === 'cost' ? <CostTab productId={p.id} components={p.components} currency={p.sellingCurrency} locale={locale} t={t} /> : null}

      {tab === 'inventory' ? (
        <InventoryTab items={p.inventoryItems} stockByItem={stockByItem} capacity={capacity} limitingName={limitingName} locale={locale} t={t} />
      ) : null}

      {tab === 'usage' ? (
        <OrderUsageForm
          productId={p.id}
          locale={locale}
          unitOptions={unitOptions}
          initial={{
            invoiceName: p.invoiceName ?? '',
            sellUnit: p.sellUnit,
            minSellingPrice: p.minSellingPrice != null ? String(p.minSellingPrice) : '',
            allowDiscount: p.allowDiscount,
            allowPriceOverride: p.allowPriceOverride,
            trackInventory: p.trackInventory,
          }}
        />
      ) : null}

      {tab === 'activity' ? <ActivityTab productId={p.id} sku={p.sku} locale={locale} t={t} /> : null}
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations>>;

async function PricingTab({
  product,
  price,
  now,
  locale,
  t,
}: {
  product: { id: string; sellingCurrency: 'IQD' | 'USD'; cogsPerUnit: number; prices: { id: string; kind: string; channel: string | null; price: number; currency: string; effectiveFrom: Date; note: string | null }[] };
  price: number;
  now: Date;
  locale: AppLocale;
  t: T;
}) {
  const scheduled = scheduledPrices(product.prices, now);
  const history = product.prices.filter((e) => e.kind === 'BASE' && e.effectiveFrom <= now);
  const special = product.prices.filter((e) => e.kind !== 'BASE' && e.effectiveFrom <= now);
  const channels = await getListOptions('channel', locale);
  const kindLabel = (k: string) => t(`price.${k === 'WHOLESALE' ? 'wholesale' : k === 'CHANNEL' ? 'channel' : 'base'}`);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-4 text-sm">
        <span>{t('price.current')}: <strong>{formatMoney(price, product.sellingCurrency, locale)}</strong></span>
      </div>

      <AddPriceForm productId={product.id} locale={locale} today={dateInputValue(now)} channels={channels} />

      {scheduled.length ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('price.scheduled')}</h3>
          <DataTable
            columns={[{ label: t('price.kind') }, { label: t('price.effectiveFrom') }, { label: t('f.price'), align: 'end' }, { label: t('price.note') }, { label: '', align: 'end' }]}
            rows={scheduled.map((e) => [
              `${kindLabel(e.kind)}${e.channel ? ` · ${enumLabel(e.channel, locale)}` : ''}`,
              formatDate(e.effectiveFrom, locale),
              formatMoney(e.price, e.currency as 'IQD' | 'USD', locale),
              e.note ?? '—',
              <ConfirmButton key="d" action={deleteProductPrice.bind(null, e.id, product.id, locale)} label={t('delete')} confirm={t('confirmDelete')} />,
            ])}
            emptyLabel={t('none')}
          />
        </div>
      ) : null}

      {special.length ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('price.special')}</h3>
          <DataTable
            columns={[{ label: t('price.kind') }, { label: t('f.price'), align: 'end' }, { label: t('price.effectiveFrom') }]}
            rows={special.map((e) => [
              `${kindLabel(e.kind)}${e.channel ? ` · ${enumLabel(e.channel, locale)}` : ''}`,
              formatMoney(e.price, e.currency as 'IQD' | 'USD', locale),
              formatDate(e.effectiveFrom, locale),
            ])}
            emptyLabel={t('none')}
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t('price.history')}</h3>
        <DataTable
          columns={[{ label: t('price.effectiveFrom') }, { label: t('f.price'), align: 'end' }, { label: t('price.note') }]}
          rows={history.map((e) => [formatDate(e.effectiveFrom, locale), formatMoney(e.price, e.currency as 'IQD' | 'USD', locale), e.note ?? '—'])}
          emptyLabel={t('price.historyEmpty')}
        />
      </div>
    </div>
  );
}

function CostTab({
  productId,
  components,
  currency,
  locale,
  t,
}: {
  productId: string;
  components: { id: string; name: string; quantity: DecimalLike; unitCost: DecimalLike; inventoryItemId: string | null }[];
  currency: 'IQD' | 'USD';
  locale: AppLocale;
  t: T;
}) {
  const total = components.reduce((s, c) => s + decimalNumber(c.quantity) * decimalNumber(c.unitCost), 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('costRecipe')}</h3>
        <Link href={`/admin/records/products/${productId}/cost`} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted">
          <Plus className="size-3.5" />
          {t('edit')}
        </Link>
      </div>
      <DataTable
        columns={[{ label: t('f.name') }, { label: t('f.qty'), align: 'end' }, { label: t('f.unitCost'), align: 'end' }, { label: t('f.lineTotal'), align: 'end' }]}
        rows={components.map((c) => [
          c.inventoryItemId ? `${c.name} · ${t('price.linked')}` : c.name,
          formatQuantity(c.quantity, locale),
          formatMoney(c.unitCost, currency, locale),
          formatMoney(decimalNumber(c.quantity) * decimalNumber(c.unitCost), currency, locale),
        ])}
        emptyLabel={t('costRecipeHint')}
      />
      {components.length ? <p className="text-sm font-medium">{t('f.total')}: {formatMoney(total, currency, locale)}</p> : null}
    </div>
  );
}

function InventoryTab({
  items,
  stockByItem,
  capacity,
  limitingName,
  locale,
  t,
}: {
  items: { id: string; nameEn: string; nameAr: string; unit: string; unitCost: DecimalLike; reorderPoint: DecimalLike }[];
  stockByItem: Map<string, number>;
  capacity: { producible: number | null };
  limitingName: string;
  locale: AppLocale;
  t: T;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <span>
          {t('capacity')}:{' '}
          <strong>
            {capacity.producible == null
              ? '—'
              : capacity.producible > 0 && limitingName
                ? `${formatNumber(capacity.producible, locale)} · ${t('limitedBy', { name: limitingName })}`
                : formatNumber(capacity.producible, locale)}
          </strong>
        </span>
      </div>
      <h3 className="text-sm font-semibold">{t('price.linkedItems')}</h3>
      <DataTable
        columns={[{ label: t('f.item') }, { label: t('f.currentStock'), align: 'end' }, { label: t('f.unitCost'), align: 'end' }, { label: '', align: 'end' }]}
        rows={items.map((it) => [
          locale === 'ar' ? it.nameAr : it.nameEn,
          `${formatQuantity(stockByItem.get(it.id) ?? 0, locale)} ${it.unit}`,
          it.unitCost != null ? formatMoney(it.unitCost, 'IQD', locale) : '—',
          <Link key="o" href={`/admin/records/inventory/${it.id}`} className="font-medium text-primary hover:underline">{t('open')}</Link>,
        ])}
        emptyLabel={t('price.noLinkedItems')}
      />
    </div>
  );
}

async function ActivityTab({ productId, sku, locale, t }: { productId: string; sku: string; locale: AppLocale; t: T }) {
  const logs = await prisma.auditLog.findMany({
    where: { entity: 'Product' },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { name: true } } },
  });
  const related = logs
    .filter((l) => {
      const m = (l.metadata ?? {}) as Record<string, unknown>;
      return m.id === productId || m.sku === sku;
    })
    .slice(0, 30);
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{t('tabs.activity')}</h3>
      <DataTable
        columns={[{ label: t('act.when') }, { label: t('act.action') }, { label: t('act.by') }]}
        rows={related.map((l) => {
          const m = (l.metadata ?? {}) as Record<string, unknown>;
          const detail = m.source ? ` · ${String(m.source)}` : '';
          return [formatDateTime(l.createdAt, locale), `${l.action}${detail}`, l.user?.name ?? '—'];
        })}
        emptyLabel={t('none')}
      />
    </div>
  );
}
