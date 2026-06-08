import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Coffee } from 'lucide-react';
import { requireCapability } from '@/server/auth/rbac';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney, type AppLocale } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { InvoiceToolbar } from '@/components/InvoiceToolbar';

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  await requireCapability(locale, 'view:sales');
  const t = await getTranslations('invoice');
  const loc = locale as AppLocale;

  const o = await prisma.order.findUnique({
    where: { id },
    include: { customer: true, lines: { include: { product: true } }, branch: true },
  });
  if (!o) notFound();

  const customerName =
    (loc === 'ar' ? o.customer?.nameAr : o.customer?.nameEn) ||
    o.customer?.nameEn ||
    o.customer?.nameAr ||
    o.customer?.externalId ||
    t('walkIn');
  // CR-7: customer address on the invoice (city + address line + street).
  const city = o.customer?.governorate ? enumLabel(o.customer.governorate, loc) : '';
  const addressLine = [city, o.customer?.address1, o.customer?.street].filter(Boolean).join(' · ');
  const subtotal = o.grossAmount;
  const grandTotal = o.grossAmount - o.discountAmount + o.deliveryFee;
  const m = (n: number) => formatMoney(n, o.currency, loc);

  const cell = 'px-3 py-2 align-top';
  const totalRow = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between gap-6 py-1 ${strong ? 'border-t pt-2 text-base font-bold' : 'text-sm'}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-muted/30">
      <InvoiceToolbar
        backHref={`/${locale}/admin/records/orders/${o.id}`}
        printLabel={t('print')}
        backLabel={t('back')}
        autoPrint={sp.print === '1'}
      />

      <div className="invoice-paper mx-auto my-2 max-w-[820px] bg-card p-8 shadow-sm print:my-0 print:max-w-none print:shadow-none">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b pb-5">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Coffee className="size-6" />
            </div>
            <div>
              <div className="text-lg font-bold text-foreground">{t('brand')}</div>
              <div className="text-xs text-muted-foreground">{t('tagline')}</div>
            </div>
          </div>
          <div className="text-end">
            <div className="text-2xl font-bold uppercase tracking-wide text-primary">{t('title')}</div>
            <div className="mt-1 text-sm">
              <span className="text-muted-foreground">{t('invoiceNo')}: </span>
              <span className="font-semibold">{o.orderNumber}</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">{t('date')}: </span>
              <span className="font-semibold">{formatDate(o.placedAt, loc)}</span>
            </div>
          </div>
        </div>

        {/* Bill to + status */}
        <div className="flex items-start justify-between gap-4 py-5">
          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground">{t('billTo')}</div>
            <div className="mt-1 text-sm font-semibold text-foreground">{customerName}</div>
            {o.customer?.externalId ? (
              <div className="font-mono text-xs text-muted-foreground">{o.customer.externalId}</div>
            ) : null}
            {o.customer?.phone ? (
              <div className="text-sm text-muted-foreground">
                {t('phone')}: {o.customer.phone}
              </div>
            ) : null}
            {addressLine ? <div className="text-sm text-muted-foreground">{addressLine}</div> : null}
          </div>
          <div className="text-end text-sm">
            <span className="text-muted-foreground">{t('status')}: </span>
            <span className="font-semibold">{enumLabel(o.status, loc)}</span>
          </div>
        </div>

        {/* Line items */}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y bg-muted/40 text-start text-xs uppercase text-muted-foreground">
              <th className={`${cell} text-start`}>{t('item')}</th>
              <th className={`${cell} text-end`}>{t('qty')}</th>
              <th className={`${cell} text-end`}>{t('unitPrice')}</th>
              <th className={`${cell} text-end`}>{t('lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {o.lines.map((l) => (
              <tr key={l.id} className="border-b">
                <td className={`${cell} text-start`}>
                  <div className="font-medium text-foreground">{loc === 'ar' ? l.product.nameAr : l.product.nameEn}</div>
                  <div className="text-xs text-muted-foreground">{l.sku}</div>
                </td>
                <td className={`${cell} text-end tabular-nums`}>{l.quantity}</td>
                <td className={`${cell} text-end tabular-nums`}>{m(l.unitGrossPrice)}</td>
                <td className={`${cell} text-end tabular-nums`}>{m(l.unitGrossPrice * l.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <div className="w-full max-w-[280px]">
            {totalRow(t('subtotal'), m(subtotal))}
            {o.discountAmount ? totalRow(t('discount'), `- ${m(o.discountAmount)}`) : null}
            {o.deliveryFee ? totalRow(t('delivery'), m(o.deliveryFee)) : null}
            {totalRow(t('grandTotal'), m(grandTotal), true)}
          </div>
        </div>

        <div className="mt-10 border-t pt-4 text-center text-xs text-muted-foreground">{t('thanks')}</div>
      </div>

      <style>{`@media print { body { background: #fff !important; } .invoice-paper { padding: 0 !important; } }`}</style>
    </div>
  );
}
