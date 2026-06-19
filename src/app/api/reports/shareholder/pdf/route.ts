import { createElement } from 'react';
import { NextResponse, type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { can } from '@/lib/rbac';
import type { AppLocale } from '@/lib/money';
import { getCurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';
import { buildShareholderReportData } from '@/server/reports/shareholder-data';
import { ShareholderReportPdf } from '@/server/reports/ShareholderReportPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !['OWNER', 'ADMIN'].includes(user.role) || !can(user.role, 'export:financial')) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const locale: AppLocale = req.nextUrl.searchParams.get('locale') === 'ar' ? 'ar' : 'en';
  const data = await buildShareholderReportData({ db: prisma });
  if (!data.internallyReconciled) return new NextResponse('Data integrity checks failed', { status: 409 });
  const element = createElement(ShareholderReportPdf, { data, locale }) as Parameters<typeof renderToBuffer>[0];
  const buffer = await renderToBuffer(element);
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'EXPORT',
      entity: 'shareholder_finance_report_pdf',
      metadata: { locale, snapshotHash: data.snapshotHash, asOf: data.asOf.toISOString(), rows: data.spendLines.length },
    },
  });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="laheeb-shareholder-finance-${locale}-${data.asOf.toISOString().slice(0, 10)}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
