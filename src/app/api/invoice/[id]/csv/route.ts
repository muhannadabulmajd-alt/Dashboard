import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { getInvoiceData } from '@/server/invoice/data';
import { getInvoiceLabels } from '@/server/invoice/labels';
import { toCsv } from '@/server/export/csv';
import { enumLabel } from '@/lib/enums';
import { formatDate } from '@/lib/dates';
import type { AppLocale } from '@/lib/money';
import { prisma } from '@/server/db/client';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  if (!can(user.role, 'view:sales')) return new NextResponse('Forbidden', { status: 403 });

  const { id } = await params;
  const locale = (req.nextUrl.searchParams.get('locale') ?? 'en') as AppLocale;
  const data = await getInvoiceData(id);
  if (!data) return new NextResponse('Not found', { status: 404 });
  const labels = await getInvoiceLabels(locale);
  const { order, payment } = data;
  const customerName =
    (locale === 'ar' ? order.customer?.nameAr : order.customer?.nameEn) ||
    order.customer?.nameEn ||
    order.customer?.nameAr ||
    order.customer?.externalId ||
    labels.walkIn;

  const headers = [
    'InvoiceNumber',
    'OrderId',
    'Date',
    'CustomerId',
    'Customer',
    'PaymentStatus',
    'InvoiceTotal',
    'Paid',
    'Remaining',
    'Line',
    'SKU',
    'Product',
    'Variation',
    'Unit',
    'Quantity',
    'UnitPrice',
    'LineDiscount',
    'LineTotal',
  ];
  const rows = order.lines.map((line, index) => [
    order.orderNumber,
    order.id,
    formatDate(order.placedAt, locale),
    order.customer?.externalId ?? '',
    customerName,
    labels[`paymentStatus.${payment.status}`],
    payment.total,
    payment.paid,
    payment.remaining,
    index + 1,
    line.sku,
    line.product.invoiceName || (locale === 'ar' ? line.product.nameAr : line.product.nameEn),
    [line.product.sizeLabel, enumLabel(line.product.grind, locale)].filter(Boolean).join(' '),
    line.unitLabel,
    line.quantity,
    line.unitGrossPrice,
    line.lineDiscount,
    line.lineNet,
  ]);

  await prisma.auditLog.create({
    data: { userId: user.id, action: 'EXPORT', entity: 'invoice_csv', entityId: id, metadata: { rows: rows.length, orderNumber: order.orderNumber } },
  });

  return new NextResponse(toCsv(headers, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="laheeb-invoice-${order.orderNumber}.csv"`,
    },
  });
}
