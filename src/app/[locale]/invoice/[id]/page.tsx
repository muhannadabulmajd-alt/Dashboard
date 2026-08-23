import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Coffee, FileText } from 'lucide-react';
import { requireCapability } from '@/server/auth/rbac';
import { prisma } from '@/server/db/client';
import { getInvoiceData } from '@/server/invoice/data';
import { getListEntries, getListLabel } from '@/server/lists/resolver';
import { recordInvoicePayment } from '@/server/records/orders';
import { can } from '@/lib/rbac';
import { activeInvoiceFinanceEntry } from '@/lib/invoice';
import { enumLabel } from '@/lib/enums';
import { formatMoney, type AppLocale } from '@/lib/money';
import { formatDate, formatDateTime, dateInputValue } from '@/lib/dates';
import { InvoiceToolbar } from '@/components/InvoiceToolbar';
import { Link } from '@/i18n/navigation';

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const user = await requireCapability(locale, 'view:sales');
  const t = await getTranslations('invoice');
  const loc = locale as AppLocale;
  const data = await getInvoiceData(id);
  if (!data) notFound();

  const { order: o, financeEntries, payment } = data;
  const [channelLabel, sourceLabel, paymentMethods, accounts] = await Promise.all([
    getListLabel('channel', o.channel, loc),
    getListLabel('customerSource', o.customer?.campaignSource, loc),
    getListEntries('paymentMethod'),
    can(user.role, 'manage:finance') && payment.remaining > 0
      ? prisma.financeAccount.findMany({
          where: { isActive: true, currency: o.currency },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, currency: true },
        })
      : [],
  ]);
  const methodLabel = (code: string | null | undefined) => {
    if (!code) return '—';
    const entry = paymentMethods.find((item) => item.code === code);
    return entry ? (loc === 'ar' ? entry.labelAr : entry.labelEn) : code;
  };

  const branchName = o.branch ? (loc === 'ar' ? o.branch.nameAr : o.branch.nameEn) : '—';
  const branchAddress = [o.branch?.governorate ? enumLabel(o.branch.governorate, loc) : '', o.branch?.address, o.branch?.street]
    .filter(Boolean)
    .join(' · ');
  const customerName =
    (loc === 'ar' ? o.customer?.nameAr : o.customer?.nameEn) ||
    o.customer?.nameEn ||
    o.customer?.nameAr ||
    o.customer?.externalId ||
    t('walkIn');
  const deliveryGovernorate = enumLabel(o.governorate || o.customer?.governorate, loc);
  const m = (n: number) => formatMoney(n, o.currency, loc);
  const lineDiscount = Math.max(0, o.discountAmount - o.orderDiscount);
  const receivable = financeEntries.find((entry) => payment.receivableIds.includes(entry.id));
  const paymentRows = financeEntries.filter((entry) => {
    if (!activeInvoiceFinanceEntry(entry)) return false;
    if (payment.providerReceivableIds.includes(entry.id)) return true;
    if (
      (entry.type === 'INCOME' || entry.type === 'PAYMENT_IN') &&
      !entry.obligation &&
      !entry.settlesId &&
      entry.orderId === o.id
    ) return true;
    return entry.type === 'PAYMENT_IN' && Boolean(
      entry.settlesId &&
      [...payment.receivableIds, ...payment.providerReceivableIds].includes(entry.settlesId),
    );
  });
  const canManageFinance = can(user.role, 'manage:finance');
  const canManageOrders = can(user.role, 'manage:orders');
  const showPaymentForm = canManageFinance && payment.remaining > 0 && payment.receivableIds.length > 0;
  const cell = 'px-3 py-2 align-top';

  return (
    <div className="min-h-screen bg-muted/30">
      <InvoiceToolbar
        backHref={`/${locale}/admin/records/orders/${o.id}`}
        printLabel={t('print')}
        pdfHref={`/api/invoice/${o.id}/pdf?locale=${locale}`}
        pdfLabel={t('downloadPdf')}
        csvHref={`/api/invoice/${o.id}/csv?locale=${locale}`}
        csvLabel={t('exportCsv')}
        backLabel={t('back')}
        autoPrint={sp.print === '1'}
      />

      <div className="invoice-paper mx-auto my-2 max-w-[920px] bg-card p-8 shadow-sm print:my-0 print:max-w-none print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Coffee className="size-6" />
            </div>
            <div>
              <div className="text-lg font-bold text-foreground">{t('brand')}</div>
              <div className="text-xs text-muted-foreground">{t('tagline')}</div>
              <div className="mt-1 text-xs text-muted-foreground">{branchName}{o.branch?.code ? ` · ${o.branch.code}` : ''}</div>
              {branchAddress ? <div className="text-xs text-muted-foreground">{branchAddress}</div> : null}
              {o.branch?.phone ? <div className="text-xs text-muted-foreground">{t('phone')}: {o.branch.phone}</div> : null}
            </div>
          </div>
          <div className="text-end">
            <div className="text-2xl font-bold uppercase tracking-wide text-primary">{t('title')}</div>
            <div className="mt-1 text-sm"><span className="text-muted-foreground">{t('invoiceNo')}: </span><span className="font-semibold">{o.orderNumber}</span></div>
            <div className="text-sm"><span className="text-muted-foreground">{t('orderId')}: </span><span className="font-mono">{o.id}</span></div>
            <div className="text-sm"><span className="text-muted-foreground">{t('date')}: </span><span className="font-semibold">{formatDate(o.placedAt, loc)}</span></div>
            <div className="text-sm"><span className="text-muted-foreground">{t('time')}: </span><span className="font-semibold">{formatDateTime(o.placedAt, loc).slice(11)}</span></div>
            <div className="text-sm"><span className="text-muted-foreground">{t('createdBy')}: </span><span className="font-semibold">{o.createdBy?.name ?? o.createdBy?.email ?? t('system')}</span></div>
          </div>
        </div>

        <section className="print:hidden my-4 rounded-lg border bg-linen/30 p-3 text-sm text-muted-foreground">
          <div className="font-semibold text-foreground">{t('guideTitle')}</div>
          <p className="mt-1 leading-6">{t('guideText')}</p>
        </section>

        <div className="grid gap-4 py-5 md:grid-cols-2">
          <section className="rounded-lg border p-4">
            <div className="text-xs font-semibold uppercase text-muted-foreground">{t('customerDetails')}</div>
            <div className="mt-1 text-sm font-semibold text-foreground">{customerName}</div>
            <div className="mt-2 grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1 text-sm">
              <span className="text-muted-foreground">{t('customerId')}</span><span className="break-words font-mono">{o.customer?.externalId || '—'}</span>
              <span className="text-muted-foreground">{t('phone')}</span><span className="break-words">{o.customer?.phone || '—'}</span>
              <span className="text-muted-foreground">{t('email')}</span><span className="break-all">{o.customer?.email || '—'}</span>
              <span className="text-muted-foreground">{t('governorate')}</span><span className="break-words">{deliveryGovernorate}</span>
              <span className="text-muted-foreground">{t('address')}</span><span className="break-words">{o.customer?.address1 || '—'}</span>
              <span className="text-muted-foreground">{t('street')}</span><span className="break-words">{o.customer?.street || '—'}</span>
            </div>
            {o.customer?.campaignSource ? <div className="text-sm text-muted-foreground">{t('source')}: {sourceLabel}</div> : null}
          </section>
          <section className="rounded-lg border p-4">
            <div className="text-xs font-semibold uppercase text-muted-foreground">{t('invoiceDetails')}</div>
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">{t('branch')}</span><span className="text-end font-medium">{branchName}</span>
              <span className="text-muted-foreground">{t('channel')}</span><span className="text-end font-medium">{channelLabel}</span>
              <span className="text-muted-foreground">{t('fulfillment')}</span><span className="text-end font-medium">{enumLabel(o.fulfillmentMethod, loc)}</span>
              <span className="text-muted-foreground">{t('governorate')}</span><span className="text-end font-medium">{deliveryGovernorate}</span>
              <span className="text-muted-foreground">{t('orderStatus')}</span><span className="text-end font-medium">{enumLabel(o.status, loc)}</span>
              <span className="text-muted-foreground">{t('paymentStatusLabel')}</span><span className="text-end font-bold">{t(`paymentStatus.${payment.status}`)}</span>
            </div>
          </section>
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y bg-muted/40 text-start text-xs uppercase text-muted-foreground">
              <th className={`${cell} text-start`}>#</th>
              <th className={`${cell} text-start`}>{t('item')}</th>
              <th className={`${cell} text-start`}>{t('variation')}</th>
              <th className={`${cell} text-start`}>{t('unit')}</th>
              <th className={`${cell} text-end`}>{t('qty')}</th>
              <th className={`${cell} text-end`}>{t('unitPrice')}</th>
              <th className={`${cell} text-end`}>{t('discount')}</th>
              <th className={`${cell} text-end`}>{t('lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {o.lines.map((line, index) => {
              const productName = line.product.invoiceName || (loc === 'ar' ? line.product.nameAr : line.product.nameEn);
              const variation = [line.product.sizeLabel, line.product.grind ? enumLabel(line.product.grind, loc) : null].filter(Boolean).join(' · ');
              return (
                <tr key={line.id} className="border-b">
                  <td className={`${cell} text-start tabular-nums`}>{index + 1}</td>
                  <td className={`${cell} text-start`}><div className="font-medium text-foreground">{productName}</div><div className="text-xs text-muted-foreground">{line.sku}</div></td>
                  <td className={`${cell} text-start text-muted-foreground`}>{variation || '—'}</td>
                  <td className={`${cell} text-start`}>{line.unitLabel}</td>
                  <td className={`${cell} text-end tabular-nums`}>{line.quantity}</td>
                  <td className={`${cell} text-end tabular-nums`}>{m(line.unitGrossPrice)}</td>
                  <td className={`${cell} text-end tabular-nums`}>{line.lineDiscount ? m(line.lineDiscount) : '—'}</td>
                  <td className={`${cell} text-end tabular-nums`}>{m(line.lineNet)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_320px]">
          <section className="rounded-lg border p-4">
            <div className="text-sm font-semibold">{t('paymentHistory')}</div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr><th className="py-1 text-start">{t('date')}</th><th className="py-1 text-start">{t('paymentMethod')}</th><th className="py-1 text-start">{t('account')}</th><th className="py-1 text-end">{t('paid')}</th></tr>
                </thead>
                <tbody>
                  {paymentRows.length ? paymentRows.map((entry) => (
                    <tr key={entry.id} className="border-t">
                      <td className="py-1">{formatDate(entry.date, loc)}</td>
                      <td className="py-1">{methodLabel(entry.paymentMethod)}</td>
                      <td className="py-1">{entry.account?.name ?? (payment.providerReceivableIds.includes(entry.id) ? entry.party?.name : '—')}</td>
                      <td className="py-1 text-end tabular-nums">{m(entry.amount)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} className="py-2 text-muted-foreground">{t('noPayments')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {showPaymentForm ? (
              <form action={recordInvoicePayment.bind(null, o.id)} className="print:hidden mt-4 grid gap-2 rounded-lg bg-muted/30 p-3 sm:grid-cols-2">
                <input type="hidden" name="locale" value={locale} />
                <input name="amount" type="number" min="1" max={payment.remaining} defaultValue={payment.remaining} className="rounded-lg border bg-background px-3 py-2 text-sm" aria-label={t('paid')} />
                <select name="accountId" required className="rounded-lg border bg-background px-3 py-2 text-sm" aria-label={t('account')}>
                  <option value="">—</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} ({account.currency})</option>)}
                </select>
                <select name="paymentMethod" className="rounded-lg border bg-background px-3 py-2 text-sm" aria-label={t('paymentMethod')}>
                  {paymentMethods.filter((method) => method.isActive).map((method) => (
                    <option key={method.code} value={method.code}>{loc === 'ar' ? method.labelAr : method.labelEn}</option>
                  ))}
                </select>
                <input name="date" type="date" defaultValue={dateInputValue()} className="rounded-lg border bg-background px-3 py-2 text-sm" aria-label={t('date')} />
                <button className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground sm:col-span-2">{t('recordPayment')}</button>
              </form>
            ) : null}
          </section>

          <section className="rounded-lg border p-4">
            <div className="space-y-1 text-sm">
              <SummaryRow label={t('subtotal')} value={m(o.grossAmount)} />
              {lineDiscount ? <SummaryRow label={t('itemDiscounts')} value={`- ${m(lineDiscount)}`} /> : null}
              {o.orderDiscount ? <SummaryRow label={t('orderDiscount')} value={`- ${m(o.orderDiscount)}`} /> : null}
              {o.deliveryFee ? <SummaryRow label={t('delivery')} value={m(o.deliveryFee)} /> : null}
              {o.extraCharges ? <SummaryRow label={t('extraCharges')} value={m(o.extraCharges)} /> : null}
              {o.refundAmount ? <SummaryRow label={t('refunds')} value={`- ${m(o.refundAmount)}`} /> : null}
              <SummaryRow label={t('grandTotal')} value={m(payment.total)} strong />
              <SummaryRow label={t('paid')} value={m(payment.paid)} />
              <SummaryRow label={t('remaining')} value={m(payment.remaining)} strong={payment.remaining > 0} />
              <SummaryRow label={t('paymentStatusLabel')} value={t(`paymentStatus.${payment.status}`)} />
              <SummaryRow label={t('paymentRoute')} value={t(`route.${payment.route}`)} />
              {payment.providerName ? <SummaryRow label={t('provider')} value={payment.providerName} /> : null}
              {payment.providerCollected > 0 ? (
                <>
                  <SummaryRow label={t('providerCollected')} value={m(payment.providerCollected)} />
                  <SummaryRow label={t('providerRemitted')} value={m(payment.providerRemitted)} />
                  <SummaryRow label={t('providerFeesOffset')} value={m(payment.providerFeesOffset)} />
                  <SummaryRow label={t('providerOutstanding')} value={m(payment.providerOutstanding)} />
                </>
              ) : null}
              {receivable?.dueDate ? <SummaryRow label={t('dueDate')} value={formatDate(receivable.dueDate, loc)} /> : null}
            </div>
          </section>
        </div>

        {canManageOrders ? (
          <div className="print:hidden mt-4 flex flex-wrap gap-2">
            <Link href={`/admin/records/orders/${o.id}/edit`} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
              <FileText className="size-4" />
              {t('editOrder')}
            </Link>
          </div>
        ) : null}

        {o.notes ? (
          <div className="mt-6 rounded-lg bg-muted/40 p-3 text-sm">
            <span className="font-semibold">{t('notes')}: </span>
            <span className="text-muted-foreground">{o.notes}</span>
          </div>
        ) : null}

        <div className="mt-10 border-t pt-4 text-center text-xs text-muted-foreground">{t('thanks')}</div>
      </div>

      <style>{`@media print { body { background: #fff !important; } .invoice-paper { padding: 0 !important; } }`}</style>
    </div>
  );
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 py-1 ${strong ? 'border-t pt-2 text-base font-bold' : ''}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="text-end tabular-nums">{value}</span>
    </div>
  );
}
