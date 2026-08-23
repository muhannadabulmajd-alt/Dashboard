import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { renderInvoicePdf } from '@/server/invoice/pdf';
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
  const pdf = await renderInvoicePdf(id, locale);
  if (!pdf) return new NextResponse('Not found', { status: 404 });

  await prisma.auditLog.create({
    data: { userId: user.id, action: 'EXPORT', entity: 'invoice_pdf', entityId: id, metadata: { orderNumber: pdf.orderNumber } },
  });

  return new NextResponse(pdf.bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdf.filename}"`,
    },
  });
}
