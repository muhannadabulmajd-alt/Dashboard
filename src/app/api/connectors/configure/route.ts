import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { configureConnector } from '@/server/connectors/configure';
import { IMPORT_DATASETS } from '@/server/ingestion/parsers';

export const runtime = 'nodejs';

// Configure a connector (URL, encrypted token, dataset, status). manage:connectors.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'manage:connectors')) return new NextResponse('Forbidden', { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | { connectorId?: string; url?: string; token?: string; dataset?: string; status?: string }
    | null;
  if (!body?.connectorId) return new NextResponse('Missing connectorId', { status: 400 });
  if (body.dataset && !IMPORT_DATASETS.includes(body.dataset as (typeof IMPORT_DATASETS)[number])) {
    return new NextResponse('Bad dataset', { status: 400 });
  }
  if (body.status && body.status !== 'ACTIVE' && body.status !== 'PAUSED') {
    return new NextResponse('Bad status', { status: 400 });
  }

  await configureConnector(body.connectorId, {
    url: body.url,
    token: body.token,
    dataset: body.dataset,
    status: body.status as 'ACTIVE' | 'PAUSED' | undefined,
  });
  return NextResponse.json({ ok: true });
}
