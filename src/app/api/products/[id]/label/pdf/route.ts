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
  const locale = (req.nextUrl.searchParams.get('locale') ?? 'en') as AppLocale;
  const label = await getProductLabelData(id, locale);
  if (!label) return new NextResponse('Not found', { status: 404 });

  const element = createElement(ProductLabelPdf, { label }) as Parameters<typeof renderToBuffer>[0];
  const buffer = await renderToBuffer(element);

  await prisma.auditLog.create({
    data: { userId: user.id, action: 'EXPORT', entity: 'product_label_pdf', entityId: id, metadata: { barcodeValue: label.barcodeValue } },
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="laheeb-product-label-${label.barcodeValue}.pdf"`,
    },
  });
}
