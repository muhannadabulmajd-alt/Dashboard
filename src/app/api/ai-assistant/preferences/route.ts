import { NextResponse, type NextRequest } from 'next/server';
import { AiAutomationPreferenceInputSchema } from '@/lib/ai-automations';
import { getAiAutomationPreferences, saveAiAutomationPreference } from '@/server/ai/automations';
import { isHttpResponse, requireAiApiUser } from '@/server/ai/http';
import { prisma } from '@/server/db/client';

export const runtime = 'nodejs';

export async function GET() {
  const userOrResponse = await requireAiApiUser();
  if (isHttpResponse(userOrResponse)) return userOrResponse;
  const [preferences, telegramIdentity] = await Promise.all([
    getAiAutomationPreferences(userOrResponse.id),
    prisma.telegramIdentity.findFirst({
      where: { userId: userOrResponse.id, status: 'ACTIVE', privateChatId: { not: null } },
      select: { id: true },
    }),
  ]);
  return NextResponse.json({ preferences, telegramLinked: Boolean(telegramIdentity) });
}

export async function PUT(request: NextRequest) {
  const userOrResponse = await requireAiApiUser();
  if (isHttpResponse(userOrResponse)) return userOrResponse;
  const parsed = AiAutomationPreferenceInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  try {
    const preference = await saveAiAutomationPreference({ user: userOrResponse, value: parsed.data });
    return NextResponse.json({ preference });
  } catch (error) {
    if (error instanceof Error && error.message === 'telegram_not_linked') {
      return NextResponse.json({ error: 'telegram_not_linked' }, { status: 409 });
    }
    console.error('AI automation preference update failed', {
      userId: userOrResponse.id,
      kind: parsed.data.kind,
      errorCode: error instanceof Error ? error.message.slice(0, 120) : 'preference_update_failed',
    });
    return NextResponse.json({ error: 'preference_update_failed' }, { status: 500 });
  }
}
