import { NextResponse, type NextRequest } from 'next/server';
import { runDueAiAutomations } from '@/server/ai/automations';
import { getAiAssistantConfig } from '@/server/ai/config';
import { isCronAuthorized } from '@/server/http/cron';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });
  const config = getAiAssistantConfig();
  if (!config.enabled || !config.apiKeyConfigured) {
    return NextResponse.json({ ok: false, error: 'assistant_unavailable' }, { status: 503 });
  }
  const result = await runDueAiAutomations({ origin: request.nextUrl.origin });
  return NextResponse.json({ ok: result.failed === 0, ...result }, { status: result.failed ? 207 : 200 });
}
