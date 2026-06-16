import { createElement } from 'react';
import { NextResponse, type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { getInvoiceData } from '@/server/invoice/data';
import { getInvoiceLabels } from '@/server/invoice/labels';
import { InvoicePdf } from '@/server/invoice/InvoicePdf';
import { prisma } from '@/server/db/client';
import type { AppLocale } from '@/lib/money';

export const runtime = 'nodejs';

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
  const element = createElement(InvoicePdf, { data, labels, locale }) as Parameters<typeof renderToBuffer>[0];
  const buffer = await renderToBuffer(element);

  await prisma.auditLog.create({
    data: { userId: user.id, action: 'EXPORT', entity: 'invoice_pdf', entityId: id, metadata: { orderNumber: data.order.orderNumber } },
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="laheeb-invoice-${data.order.orderNumber}.pdf"`,
    },
  });
}
