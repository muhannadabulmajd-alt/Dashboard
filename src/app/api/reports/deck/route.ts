import { createElement } from 'react';
import { NextResponse, type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { parseFilters } from '@/lib/filters';
import { buildBranchScope, rangeFor } from '@/server/filters/where-builder';
import { formatDate } from '@/lib/dates';
import { buildDeckData } from '@/server/reports/deck-data';
import { Deck } from '@/server/reports/Deck';
import { prisma } from '@/server/db/client';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'export:data')) return new NextResponse('Forbidden', { status: 403 });

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const filters = parseFilters(sp);
  const scope = buildBranchScope(user);
  const range = rangeFor(filters);
  const periodLabel = `${formatDate(range.start)} → ${formatDate(range.end)}`;

  const data = await buildDeckData(user, filters, scope, range, periodLabel);
  const element = createElement(Deck, { data }) as Parameters<typeof renderToBuffer>[0];
  const buffer = await renderToBuffer(element);

  await prisma.auditLog.create({
    data: { userId: user.id, action: 'EXPORT', entity: 'management_deck' },
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="laheeb-management-deck.pdf"',
    },
  });
}
