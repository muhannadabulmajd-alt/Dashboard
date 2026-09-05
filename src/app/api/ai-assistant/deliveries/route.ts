import { NextResponse } from 'next/server';
import { getUserAiDeliveryHealth } from '@/server/ai/deliveries';
import { isHttpResponse, requireAiApiUser } from '@/server/ai/http';

export const runtime = 'nodejs';

export async function GET() {
  const userOrResponse = await requireAiApiUser();
  if (isHttpResponse(userOrResponse)) return userOrResponse;
  const health = await getUserAiDeliveryHealth(userOrResponse.id);
  return NextResponse.json({ health });
}
