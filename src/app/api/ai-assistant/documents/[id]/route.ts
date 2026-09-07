import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { prisma } from '@/server/db/client';
import { generateAiDocument } from '@/server/ai/documents';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  if (!can(user.role, 'use:ai-assistant')) return new NextResponse('Forbidden', { status: 403 });
  const { id } = await params;
  const document = await prisma.aiDocument.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!document) return new NextResponse('Not found', { status: 404 });

  try {
    const ready = await generateAiDocument(document.id);
    if (!ready.content || !ready.fileName) return new NextResponse('Document pending', { status: 202 });
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'AI_PDF_DOWNLOADED',
        entity: ready.recordType,
        entityId: ready.recordId,
        metadata: { documentId: ready.id, kind: ready.kind },
      },
    });
    return new NextResponse(Uint8Array.from(ready.content), {
      headers: {
        'Content-Type': ready.mimeType,
        'Content-Disposition': `attachment; filename="${ready.fileName.replace(/[\r\n"]/g, '')}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'document_pending' }, { status: 202 });
  }
}
