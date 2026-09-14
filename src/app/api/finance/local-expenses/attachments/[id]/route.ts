import { getCurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';

export const dynamic = 'force-dynamic';

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100) || 'receipt';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getCurrentUser();
  if (!actor) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;
  const attachment = await prisma.localExpenseAttachment.findUnique({
    where: { id },
    include: {
      request: {
        select: {
          submittedById: true,
          location: {
            select: {
              userAccesses: {
                where: { userId: actor.id },
                select: { canView: true, canRecordExpense: true, canApprove: true },
              },
            },
          },
        },
      },
    },
  });
  if (!attachment) return new Response('Not found', { status: 404 });
  const access = attachment.request.location.userAccesses[0];
  const allowed = actor.role === 'OWNER'
    || actor.role === 'ADMIN'
    || attachment.request.submittedById === actor.id
    || Boolean(access?.canView && (access.canRecordExpense || access.canApprove));
  if (!allowed) return new Response('Not found', { status: 404 });

  const content = new Uint8Array(attachment.content);
  return new Response(content.buffer, {
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': contentDisposition(attachment.fileName),
      'Content-Length': String(attachment.byteSize),
      'Content-Type': attachment.mimeType,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
