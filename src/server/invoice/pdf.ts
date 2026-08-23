import 'server-only';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import type { AppLocale } from '@/lib/money';
import { getInvoiceData } from './data';
import { getInvoiceLabels } from './labels';
import { InvoicePdf } from './InvoicePdf';

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'invoice';
}

export async function renderInvoicePdf(orderId: string, locale: AppLocale) {
  const data = await getInvoiceData(orderId);
  if (!data) return null;

  const labels = await getInvoiceLabels(locale);
  const element = createElement(InvoicePdf, { data, labels, locale }) as Parameters<typeof renderToBuffer>[0];
  const buffer = await renderToBuffer(element);

  return {
    bytes: Uint8Array.from(buffer),
    filename: `laheeb-invoice-${safeFilenamePart(data.order.orderNumber)}.pdf`,
    orderNumber: data.order.orderNumber,
  };
}
