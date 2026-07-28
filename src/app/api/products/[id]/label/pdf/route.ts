import { createElement } from 'react';
import { NextResponse, type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { prisma } from '@/server/db/client';
import { getProductLabelData } from '@/server/products/label-data';
import { ProductLabelPdf } from '@/server/products/ProductLabelPdf';
import type { AppLocale } from '@/lib/money';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  if (!can(user.role, 'manage:products')) return new NextResponse('Forbidden', { status: 403 });

  const { id } = await params;
  const localeParam = req.nextUrl.searchParams.get('locale');
  const locale: AppLocale = localeParam === 'ar' ? 'ar' : 'en';
  const requestedCopies = Number.parseInt(req.nextUrl.searchParams.get('copies') ?? '1', 10);
  const copies = Number.isFinite(requestedCopies) ? Math.min(24, Math.max(1, requestedCopies)) : 1;
  const disposition = req.nextUrl.searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';
  const label = await getProductLabelData(id, locale);
  if (!label) return new NextResponse('Not found', { status: 404 });

  const element = createElement(ProductLabelPdf, { label, copies }) as Parameters<typeof renderToBuffer>[0];
  const buffer = await renderToBuffer(element);

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'EXPORT',
      entity: 'product_label_pdf',
      entityId: id,
      metadata: { retailBarcode: label.retailBarcode, copies, disposition },
    },
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="laheeb-product-label-${label.retailBarcode}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
