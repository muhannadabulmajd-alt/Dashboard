import 'server-only';
import arMessages from '@/i18n/messages/ar.json';
import enMessages from '@/i18n/messages/en.json';

const LABEL_KEYS = [
  'title',
  'invoiceNo',
  'date',
  'paymentStatusLabel',
  'paymentRoute',
  'provider',
  'providerCollected',
  'providerRemitted',
  'providerFeesOffset',
  'providerOutstanding',
  'brand',
  'tagline',
  'customerDetails',
  'billTo',
  'customerId',
  'walkIn',
  'phone',
  'email',
  'governorate',
  'address',
  'street',
  'source',
  'segment',
  'customerNotes',
  'deliveryDetails',
  'fulfillment',
  'branch',
  'channel',
  'orderStatus',
  'createdBy',
  'system',
  'notes',
  'item',
  'variation',
  'unit',
  'qty',
  'unitPrice',
  'lineTotal',
  'subtotal',
  'itemDiscounts',
  'orderDiscount',
  'delivery',
  'extraCharges',
  'refunds',
  'grandTotal',
  'paid',
  'remaining',
  'paymentHistory',
  'noPayments',
  'paymentStatus.PAID',
  'paymentStatus.UNPAID',
  'paymentStatus.PARTIAL',
  'paymentStatus.REFUNDED',
  'paymentStatus.CANCELED',
  'route.DIRECT',
  'route.PROVIDER',
  'route.CREDIT',
  'route.NONE',
] as const;

export async function getInvoiceLabels(locale: string): Promise<Record<string, string>> {
  const invoice = locale === 'ar' ? arMessages.invoice : enMessages.invoice;
  return Object.fromEntries(LABEL_KEYS.map((key) => {
    const value = key.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[segment];
    }, invoice);
    if (typeof value !== 'string') throw new Error(`missing_invoice_label:${key}`);
    return [key, value];
  }));
}
