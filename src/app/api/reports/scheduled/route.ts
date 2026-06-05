import { createElement } from 'react';
import { NextResponse, type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { runScheduledReport, type ReportKind } from '@/server/reports/scheduled';
import { Deck } from '@/server/reports/Deck';

export const runtime = 'nodejs';

// Protected by CRON_SECRET so only Vercel Cron (or an authorized caller) can run
// it. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get('secret') === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new NextResponse('Unauthorized', { status: 401 });

  const kind = (req.nextUrl.searchParams.get('kind') ?? 'weekly') as ReportKind;
  if (kind !== 'weekly' && kind !== 'monthly') return new NextResponse('Bad kind', { status: 400 });

  const { data } = await runScheduledReport(kind);

  if (req.nextUrl.searchParams.get('format') === 'pdf') {
    const element = createElement(Deck, { data }) as Parameters<typeof renderToBuffer>[0];
    const buffer = await renderToBuffer(element);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="laheeb-${kind}-report.pdf"`,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    kind,
    period: data.periodLabel,
    kpis: data.executive,
  });
}
