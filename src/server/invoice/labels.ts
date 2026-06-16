import 'server-only';
import { getTranslations } from 'next-intl/server';

const LABEL_KEYS = [
  'title',
  'invoiceNo',
  'date',
  'paymentStatusLabel',
  'brand',
  'tagline',
  'customerDetails',
  'customerId',
  'walkIn',
  'phone',
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
] as const;

export async function getInvoiceLabels(locale: string): Promise<Record<string, string>> {
  const t = await getTranslations({ locale, namespace: 'invoice' });
  return Object.fromEntries(LABEL_KEYS.map((key) => [key, t(key)]));
}
