import { NextResponse } from 'next/server';
import { getUserAiDeliveryHealth, replayUserAiDeliveries } from '@/server/ai/deliveries';
import { isHttpResponse, requireAiApiUser } from '@/server/ai/http';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  const userOrResponse = await requireAiApiUser();
  if (isHttpResponse(userOrResponse)) return userOrResponse;
  const result = await replayUserAiDeliveries({ userId: userOrResponse.id });
  const health = await getUserAiDeliveryHealth(userOrResponse.id);
  return NextResponse.json({ result, health }, { status: result.failed ? 207 : 200 });
}
