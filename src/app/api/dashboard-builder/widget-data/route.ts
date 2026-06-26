import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { DashboardFiltersSchema, parseFilters } from '@/lib/filters';
import { WidgetSchema } from '@/lib/dashboard-builder';
import { resolveWidgetData } from '@/server/dashboard-builder/service';
import type { AppLocale } from '@/lib/money';

const PayloadSchema = z.object({
  widget: WidgetSchema,
  filters: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  locale: z.enum(['ar', 'en']).default('ar'),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'view:dashboard-builder')) return new NextResponse('Forbidden', { status: 403 });
  const parsed = PayloadSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const filters = DashboardFiltersSchema.parse(parseFilters(parsed.data.filters ?? {}));
  const data = await resolveWidgetData(
    { id: user.id, role: user.role, branchId: user.branchId },
    parsed.data.widget,
    filters,
    parsed.data.locale as AppLocale,
  );
  return NextResponse.json(data);
}
