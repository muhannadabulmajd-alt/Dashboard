import { NextResponse, type NextRequest } from 'next/server';
import { AiCapabilityUpdateSchema } from '@/lib/ai-capabilities';
import { getAiCapabilityStates, updateAiCapabilitySetting } from '@/server/ai/capabilities';
import { isHttpResponse, requireAiApiUser } from '@/server/ai/http';

export const runtime = 'nodejs';

export async function GET() {
  const userOrResponse = await requireAiApiUser();
  if (isHttpResponse(userOrResponse)) return userOrResponse;
  if (userOrResponse.role !== 'OWNER') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ capabilities: await getAiCapabilityStates() });
}

export async function PUT(request: NextRequest) {
  const userOrResponse = await requireAiApiUser();
  if (isHttpResponse(userOrResponse)) return userOrResponse;
  if (userOrResponse.role !== 'OWNER') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = AiCapabilityUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  try {
    const capability = await updateAiCapabilitySetting({ user: userOrResponse, value: parsed.data });
    return NextResponse.json({ capability });
  } catch (error) {
    console.error('AI capability update failed', {
      userId: userOrResponse.id,
      capability: parsed.data.capability,
      errorCode: error instanceof Error ? error.message.split(':')[0].slice(0, 120) : 'capability_update_failed',
    });
    return NextResponse.json({ error: 'capability_update_failed' }, { status: 500 });
  }
}
