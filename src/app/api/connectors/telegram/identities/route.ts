import { Prisma } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/server/db/client';
import { isTelegramAdminResponse, requireTelegramAdmin } from '@/server/telegram/admin';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const userOrResponse = await requireTelegramAdmin();
  if (isTelegramAdminResponse(userOrResponse)) return userOrResponse;
  const body = await request.json().catch(() => null) as {
    action?: 'link' | 'revoke';
    telegramUserId?: string;
    userId?: string;
  } | null;
  const telegramUserId = body?.telegramUserId?.trim();
  if (!body?.action || !telegramUserId || !/^\d+$/.test(telegramUserId)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    if (body.action === 'link') {
      if (!body.userId) return NextResponse.json({ error: 'user_required' }, { status: 400 });
      const atlasUser = await prisma.user.findFirst({
        where: { id: body.userId, isActive: true },
        select: { id: true, name: true, role: true },
      });
      if (!atlasUser) return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
      const identity = await prisma.telegramIdentity.upsert({
        where: { telegramUserId },
        create: {
          telegramUserId,
          userId: atlasUser.id,
          status: 'ACTIVE',
          linkedById: userOrResponse.id,
          linkedAt: new Date(),
        },
        update: {
          userId: atlasUser.id,
          status: 'ACTIVE',
          linkedById: userOrResponse.id,
          linkedAt: new Date(),
          revokedAt: null,
        },
      });
      await prisma.auditLog.create({
        data: {
          userId: userOrResponse.id,
          action: 'TELEGRAM_IDENTITY_LINKED',
          entity: 'TelegramIdentity',
          entityId: identity.id,
          metadata: { telegramUserId, atlasUserId: atlasUser.id, atlasUserName: atlasUser.name, atlasRole: atlasUser.role },
        },
      });
      return NextResponse.json({ ok: true, identityId: identity.id });
    }

    if (body.action === 'revoke') {
      const identity = await prisma.telegramIdentity.findUnique({ where: { telegramUserId } });
      if (!identity) return NextResponse.json({ error: 'identity_not_found' }, { status: 404 });
      await prisma.telegramIdentity.update({
        where: { id: identity.id },
        data: { status: 'REVOKED', userId: null, revokedAt: new Date() },
      });
      await prisma.auditLog.create({
        data: {
          userId: userOrResponse.id,
          action: 'TELEGRAM_IDENTITY_REVOKED',
          entity: 'TelegramIdentity',
          entityId: identity.id,
          metadata: { telegramUserId, previousAtlasUserId: identity.userId },
        },
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'mapping_conflict' }, { status: 409 });
    }
    console.error('Telegram identity update failed', { telegramUserId, action: body.action, error });
    return NextResponse.json({ error: 'identity_update_failed' }, { status: 500 });
  }
}
