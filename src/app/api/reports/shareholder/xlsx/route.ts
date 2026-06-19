import { NextResponse } from 'next/server';
import { can } from '@/lib/rbac';
import { getCurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';
import { buildShareholderReportData } from '@/server/reports/shareholder-data';
import { buildShareholderWorkbook } from '@/server/reports/shareholder-workbook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !['OWNER', 'ADMIN'].includes(user.role) || !can(user.role, 'export:financial')) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const data = await buildShareholderReportData({ db: prisma });
  if (!data.internallyReconciled) return new NextResponse('Data integrity checks failed', { status: 409 });
  const buffer = await buildShareholderWorkbook(data);
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'EXPORT',
      entity: 'shareholder_finance_report_xlsx',
      metadata: { snapshotHash: data.snapshotHash, asOf: data.asOf.toISOString(), rows: data.spendLines.length },
    },
  });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="laheeb-shareholder-finance-${data.asOf.toISOString().slice(0, 10)}.xlsx"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
