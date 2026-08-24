import { Search, ShoppingBag, UserRound } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { formatDate } from '@/lib/dates';
import { enumLabel } from '@/lib/enums';
import { formatMoney, formatNumber } from '@/lib/money';
import { DataTable } from '@/components/data-table/DataTable';
import { KpiCard } from '@/components/kpi/KpiCard';
import { ActionLink, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Link } from '@/i18n/navigation';
import { findProductBuyers } from '@/server/customers/product-buyers';
import { prisma } from '@/server/db/client';
import { getPageContext } from '@/server/page-context';

export default async function ProductBuyersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, filters, scope, range } = await getPageContext(params, searchParams, 'view:customers');
  const t = await getTranslations('productBuyers');
  const sp = await searchParams;
  const productQuery = typeof sp.product === 'string' ? sp.product.trim() : '';
  const products = await prisma.product.findMany({
    select: { sku: true, nameEn: true, nameAr: true, sizeLabel: true, isActive: true },
    orderBy: [{ isActive: 'desc' }, { productLine: 'asc' }, { nameEn: 'asc' }, { sku: 'asc' }],
  });
  const result = productQuery
    ? await findProductBuyers({ productQuery, filters, scope, range })
    : null;

  const exact = result?.kind === 'exact' ? result : null;
  const period = `${formatDate(range.start, locale)} - ${formatDate(range.end, locale)}`;
  const columns = [
    { label: t('customer') },
    { label: t('phone') },
    { label: t('city') },
    { label: t('orders'), align: 'end' as const },
    { label: t('units'), align: 'end' as const },
    { label: t('itemSales'), align: 'end' as const },
    { label: t('lastPurchase') },
    { label: '' },
  ];
  const rows = exact?.buyers.map((buyer) => {
    const name = (locale === 'ar' ? buyer.nameAr : buyer.nameEn) || buyer.nameEn || buyer.nameAr || buyer.externalId || t('unnamed');
    return [
      <div key="customer" className="min-w-48">
        <div className="font-semibold text-roast">{name}</div>
        <div className="font-mono text-xs text-muted-foreground">{buyer.externalId ?? '—'}</div>
      </div>,
      <span key="phone" dir="ltr">{buyer.phone ?? '—'}</span>,
      enumLabel(buyer.governorate, locale),
      formatNumber(buyer.orders, locale),
      formatNumber(buyer.units, locale),
      formatMoney(buyer.itemSales, 'IQD', locale),
      formatDate(buyer.lastPurchaseAt, locale),
      <Link key="open" href={`/admin/records/customers/${buyer.customerId}`} className="font-semibold text-primary hover:underline">
        {t('open')}
      </Link>,
    ];
  }) ?? [];

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<ActionLink href="/customers" variant="secondary">{t('back')}</ActionLink>}
      />

      <Card className="p-3 sm:p-4" variant="surface">
        <form className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_auto]" method="get">
          <label className="space-y-1.5 text-sm font-semibold text-roast">
            <span>{t('product')}</span>
            <select
              name="product"
              defaultValue={productQuery}
              required
              className="min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm font-normal"
            >
              <option value="">{t('chooseProduct')}</option>
              {products.map((product) => (
                <option key={product.sku} value={product.sku}>
                  {(locale === 'ar' ? product.nameAr : product.nameEn) || product.nameEn || product.nameAr} · {product.sizeLabel} · {product.sku}{product.isActive ? '' : ` · ${t('inactive')}`}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-semibold text-roast">
            <span>{t('period')}</span>
            <select name="range" defaultValue={filters.range} className="min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm font-normal">
              <option value="all">{t('ranges.all')}</option>
              <option value="this_month">{t('ranges.thisMonth')}</option>
              <option value="last_month">{t('ranges.lastMonth')}</option>
              <option value="7d">{t('ranges.sevenDays')}</option>
              <option value="custom">{t('ranges.custom')}</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1.5 text-sm font-semibold text-roast">
              <span>{t('from')}</span>
              <input name="from" type="date" defaultValue={filters.from} className="min-h-11 w-full rounded-lg border border-border bg-card px-2 text-sm font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-semibold text-roast">
              <span>{t('to')}</span>
              <input name="to" type="date" defaultValue={filters.to} className="min-h-11 w-full rounded-lg border border-border bg-card px-2 text-sm font-normal" />
            </label>
          </div>
          <button type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground">
            <Search className="size-4" />
            {t('find')}
          </button>
        </form>
      </Card>

      {!result ? (
        <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />
      ) : result.kind === 'none' ? (
        <EmptyState title={t('notFoundTitle')} message={t('notFoundMessage')} />
      ) : result.kind === 'ambiguous' ? (
        <Card className="space-y-2 p-3 sm:p-4" variant="accent">
          <h2 className="font-semibold text-roast">{t('chooseMatch')}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {result.candidates.map((product) => (
              <Link
                key={product.id}
                href={`/customers/product-buyers?product=${encodeURIComponent(product.sku)}&range=${filters.range}`}
                className="rounded-lg border border-border bg-card p-3 text-sm hover:border-primary"
              >
                <strong>{locale === 'ar' ? product.nameAr : product.nameEn}</strong>
                <span className="mt-1 block text-xs text-muted-foreground">{product.sizeLabel} · {product.sku}</span>
              </Link>
            ))}
          </div>
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4" variant="accent">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-primary"><ShoppingBag className="size-4" />{t('resultFor')}</div>
              <h2 className="mt-1 text-lg font-bold text-roast">{locale === 'ar' ? exact!.product.nameAr : exact!.product.nameEn}</h2>
              <p className="text-xs text-muted-foreground">{exact!.product.sizeLabel} · {exact!.product.sku}</p>
            </div>
            <div className="text-sm text-muted-foreground">{period}</div>
          </Card>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label={t('uniqueBuyers')} value={formatNumber(exact!.buyers.length, locale)} locale={locale} />
            <KpiCard label={t('orders')} value={formatNumber(exact!.orderCount, locale)} locale={locale} />
            <KpiCard label={t('units')} value={formatNumber(exact!.units, locale)} locale={locale} />
            <KpiCard label={t('itemSales')} value={formatMoney(exact!.itemSales, 'IQD', locale)} locale={locale} />
          </section>

          {exact!.guestOrderCount > 0 ? (
            <Card className="p-3 text-sm text-muted-foreground" variant="accent">
              {t('guestOrders', { count: exact!.guestOrderCount })}
            </Card>
          ) : null}

          <div className="grid gap-3 md:hidden">
            {exact!.buyers.length ? exact!.buyers.map((buyer) => {
              const name = (locale === 'ar' ? buyer.nameAr : buyer.nameEn) || buyer.nameEn || buyer.nameAr || buyer.externalId || t('unnamed');
              return (
                <Card key={buyer.customerId} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words font-bold text-roast">{name}</div>
                      <div className="mt-1 text-sm" dir="ltr">{buyer.phone ?? '—'}</div>
                    </div>
                    <UserRound className="size-5 shrink-0 text-primary" />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><dt className="text-xs text-muted-foreground">{t('orders')}</dt><dd className="font-semibold">{formatNumber(buyer.orders, locale)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t('units')}</dt><dd className="font-semibold">{formatNumber(buyer.units, locale)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t('itemSales')}</dt><dd className="font-semibold">{formatMoney(buyer.itemSales, 'IQD', locale)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t('lastPurchase')}</dt><dd className="font-semibold">{formatDate(buyer.lastPurchaseAt, locale)}</dd></div>
                  </dl>
                  <ActionLink href={`/admin/records/customers/${buyer.customerId}`} variant="secondary" className="mt-3">{t('open')}</ActionLink>
                </Card>
              );
            }) : <EmptyState message={t('noBuyers')} />}
          </div>
          <div className="hidden md:block">
            <DataTable columns={columns} rows={rows} emptyLabel={t('noBuyers')} />
          </div>
        </>
      )}
    </>
  );
}
