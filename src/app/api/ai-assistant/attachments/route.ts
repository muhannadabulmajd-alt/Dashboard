import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isHttpResponse, requireAiApiUser } from '@/server/ai/http';
import { AiAttachmentError, storeAiAttachment } from '@/server/ai/attachments';
import { getAiAssistantConfig } from '@/server/ai/config';
import { prisma } from '@/server/db/client';

export const runtime = 'nodejs';
export const maxDuration = 30;

const UploadMetadataSchema = z.object({
  conversationId: z.string().cuid().optional(),
}).strict();

function attachmentError(error: unknown): NextResponse {
  const code = error instanceof AiAttachmentError ? error.code : 'attachment_upload_failed';
  const status = code === 'attachment_too_large' ? 413 : code === 'attachment_upload_failed' ? 500 : 400;
  return NextResponse.json({ error: code }, { status });
}

export async function POST(request: NextRequest) {
  const userOrResponse = await requireAiApiUser();
  if (isHttpResponse(userOrResponse)) return userOrResponse;
  const maxBytes = getAiAssistantConfig().mediaMaxBytes;
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes + 1024 * 1024) {
    return NextResponse.json({ error: 'attachment_too_large' }, { status: 413 });
  }

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AiAttachmentError('attachment_missing');
    const metadata = UploadMetadataSchema.parse({
      conversationId: typeof form.get('conversationId') === 'string' && form.get('conversationId')
        ? form.get('conversationId')
        : undefined,
    });
    if (metadata.conversationId) {
      const conversation = await prisma.aiConversation.findFirst({
        where: { id: metadata.conversationId, userId: userOrResponse.id, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!conversation) return NextResponse.json({ error: 'conversation_not_found' }, { status: 404 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const attachment = await storeAiAttachment({
      userId: userOrResponse.id,
      channel: 'WEB',
      bytes,
      declaredMimeType: file.type,
      fileName: file.name,
    });
    await prisma.auditLog.create({
      data: {
        userId: userOrResponse.id,
        action: 'AI_ATTACHMENT_UPLOADED',
        entity: 'AiAttachment',
        entityId: attachment.id,
        metadata: {
          kind: attachment.kind,
          mimeType: attachment.mimeType,
          byteSize: attachment.byteSize,
          channel: 'WEB',
        },
      },
    });
    return NextResponse.json({
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
      kind: attachment.kind,
      href: `/api/ai-assistant/attachments/${attachment.id}`,
    }, { status: 201 });
  } catch (error) {
    return attachmentError(error);
  }
}
