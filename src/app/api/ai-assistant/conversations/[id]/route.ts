import { NextResponse } from 'next/server';
import { isHttpResponse, requireAiApiUser } from '@/server/ai/http';
import { prisma } from '@/server/db/client';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userOrResponse = await requireAiApiUser();
  if (isHttpResponse(userOrResponse)) return userOrResponse;
  const { id } = await params;
  const conversation = await prisma.aiConversation.findFirst({
    where: {
      id,
      userId: userOrResponse.id,
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      title: true,
      locale: true,
      channel: true,
      createdAt: true,
      lastMessageAt: true,
      messages: {
        select: { id: true, role: true, kind: true, content: true, payload: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      },
      pendingActions: {
        select: {
          id: true,
          type: true,
          risk: true,
          status: true,
          confirmationChallenge: true,
          confirmationRequestedAt: true,
          preview: true,
          expiresAt: true,
          result: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      },
    },
  });
  if (!conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ conversation });
}
