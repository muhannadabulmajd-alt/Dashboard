import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { confirmPendingAction } from '@/server/ai/actions';
import { actionErrorResponse } from '@/server/ai/action-http';
import { isHttpResponse, requireAiApiUser } from '@/server/ai/http';

const BodySchema = z.object({
  locale: z.enum(['ar', 'en']).default('en'),
  confirmationText: z.string().trim().max(200).optional(),
}).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrResponse = await requireAiApiUser();
  if (isHttpResponse(userOrResponse)) return userOrResponse;
  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const { id } = await params;

  try {
    const result = await confirmPendingAction({
      actionId: id,
      user: userOrResponse,
      locale: parsed.data.locale,
      confirmationText: parsed.data.confirmationText,
    });
    return NextResponse.json(result);
  } catch (error) {
    return actionErrorResponse(error, parsed.data.locale);
  }
}
