import { NextResponse } from 'next/server';
import { can } from '@/lib/rbac';
import { getCurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';
import { isAiCapabilityEnabled } from '@/server/ai/capabilities';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  if (!can(user.role, 'use:ai-assistant')) return new NextResponse('Forbidden', { status: 403 });
  if (!await isAiCapabilityEnabled('MEDIA_REPORTS')) return new NextResponse('Unavailable', { status: 503 });
  const { id } = await params;
  const attachment = await prisma.aiAttachment.findFirst({
    where: { id, userId: user.id, status: { not: 'REJECTED' }, expiresAt: { gt: new Date() } },
    select: { id: true, content: true, mimeType: true, fileName: true, byteSize: true },
  });
  if (!attachment) return new NextResponse('Not found', { status: 404 });
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'AI_ATTACHMENT_DOWNLOADED',
      entity: 'AiAttachment',
      entityId: attachment.id,
      metadata: { mimeType: attachment.mimeType, byteSize: attachment.byteSize },
    },
  });
  const fileName = attachment.fileName.replace(/[\r\n"\\]/g, '-');
  return new NextResponse(Uint8Array.from(attachment.content), {
    headers: {
      'Content-Type': attachment.mimeType,
      'Content-Length': String(attachment.byteSize),
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
