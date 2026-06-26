import { createElement } from 'react';
import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { Font, renderToBuffer } from '@react-pdf/renderer';
import { getCurrentUser } from '@/server/auth/session';
import { getDashboard, resolveDashboardWidgetData } from '@/server/dashboard-builder/service';
import { DashboardPdf } from '@/server/dashboard-builder/DashboardPdf';
import { parseFilters } from '@/lib/filters';
import type { AppLocale } from '@/lib/money';

export const runtime = 'nodejs';

Font.register({ family: 'Amiri', src: path.join(process.cwd(), 'public/fonts/Amiri-Regular.ttf') });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  const { id } = await params;
  const locale = (req.nextUrl.searchParams.get('locale') === 'en' ? 'en' : 'ar') as AppLocale;
  const dashboard = await getDashboard({ id: user.id, role: user.role, branchId: user.branchId }, id);
  if (!dashboard) return new NextResponse('Not found', { status: 404 });
  if (!dashboard.canExport) return new NextResponse('Forbidden', { status: 403 });

  const config = { ...dashboard.config, globalFilters: parseFilters(Object.fromEntries(req.nextUrl.searchParams.entries())) };
  const rows = await resolveDashboardWidgetData({ id: user.id, role: user.role, branchId: user.branchId }, config, locale);
  const dataByWidget = Object.fromEntries(rows.map((row) => [row.widgetId, row.data]));
  const element = createElement(DashboardPdf, {
    name: dashboard.name,
    description: dashboard.description,
    config,
    dataByWidget,
    locale,
  }) as Parameters<typeof renderToBuffer>[0];
  const buffer = await renderToBuffer(element);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${dashboard.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-dashboard.pdf"`,
    },
  });
}
