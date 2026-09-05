import { NextResponse } from 'next/server';
import { can } from '@/lib/rbac';
import { getCurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';
import { getAiReportExport, type AiReportFormat } from '@/server/ai/reports';

export const runtime = 'nodejs';

const FORMATS = new Set<AiReportFormat>(['pdf', 'xlsx', 'csv']);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; format: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  if (!can(user.role, 'use:ai-assistant')) return new NextResponse('Forbidden', { status: 403 });
  const { id, format: rawFormat } = await params;
  if (!FORMATS.has(rawFormat as AiReportFormat)) return new NextResponse('Not found', { status: 404 });
  const report = await getAiReportExport({ reportId: id, userId: user.id, format: rawFormat as AiReportFormat });
  if (!report) return new NextResponse('Not found', { status: 404 });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'AI_REPORT_DOWNLOADED',
      entity: 'AiReportSnapshot',
      entityId: id,
      metadata: { reportType: report.reportType, format: rawFormat },
    },
  });
  return new NextResponse(report.bytes, {
    headers: {
      'Content-Type': report.contentType,
      'Content-Disposition': `attachment; filename="${report.fileName.replace(/[\r\n"]/g, '')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
