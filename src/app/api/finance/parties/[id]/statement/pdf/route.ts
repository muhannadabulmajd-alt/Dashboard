import { createElement } from 'react';
import { NextResponse, type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { parseFilters } from '@/lib/filters';
import { buildBranchScope, rangeFor } from '@/server/filters/where-builder';
import { getPartyStatementData } from '@/server/finance/party-statement';
import { PartyStatementPdf } from '@/server/finance/PartyStatementPdf';
import { prisma } from '@/server/db/client';
import type { AppLocale } from '@/lib/money';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  if (!can(user.role, 'export:financial')) return new NextResponse('Forbidden', { status: 403 });

  const { id } = await params;
  const p = req.nextUrl.searchParams;
  const locale = (p.get('locale') ?? 'en') as AppLocale;
  const filters = parseFilters(Object.fromEntries(p.entries()));
  const range = rangeFor(filters);
  const scope = buildBranchScope(user);
  const data = await getPartyStatementData(id, locale, range, scope);
  if (!data) return new NextResponse('Not found', { status: 404 });

  await prisma.auditLog.create({
    data: { userId: user.id, action: 'EXPORT', entity: 'party_statement_pdf', entityId: id, metadata: { party: data.party.name } },
  });
  const element = createElement(PartyStatementPdf, { data }) as Parameters<typeof renderToBuffer>[0];
  const pdf = await renderToBuffer(element);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="laheeb-party-statement-${id}.pdf"`,
    },
  });
}
