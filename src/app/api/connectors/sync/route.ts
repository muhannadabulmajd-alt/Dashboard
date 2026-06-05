import { NextResponse, type NextRequest } from 'next/server';
import { runAllActiveConnectors } from '@/server/connectors/sync';

export const runtime = 'nodejs';

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get('secret') === secret;
}

// Scheduled sync of all active connectors (CRON_SECRET-protected).
export async function GET(req: NextRequest) {
  if (!authorized(req)) return new NextResponse('Unauthorized', { status: 401 });
  const results = await runAllActiveConnectors();
  return NextResponse.json({ ok: true, results });
}
