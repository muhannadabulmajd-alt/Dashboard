import { NextResponse } from 'next/server';
import { isHttpResponse, requireAiApiUser } from '@/server/ai/http';
import { prisma } from '@/server/db/client';

export async function GET() {
  const userOrResponse = await requireAiApiUser();
  if (isHttpResponse(userOrResponse)) return userOrResponse;
  const conversations = await prisma.aiConversation.findMany({
    where: {
      userId: userOrResponse.id,
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      title: true,
      locale: true,
      channel: true,
      lastMessageAt: true,
      createdAt: true,
      _count: { select: { messages: true } },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
  });
  return NextResponse.json({ conversations });
}
