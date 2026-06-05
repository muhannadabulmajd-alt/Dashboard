import 'server-only';
import { Prisma } from '@prisma/client';
import { resolveRange, formatDate } from '@/lib/dates';
import { parseFilters } from '@/lib/filters';
import type { CurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';
import { buildDeckData, type DeckData } from './deck-data';

export type ReportKind = 'weekly' | 'monthly';

// Owner/finance reports run with a system owner-level context (all branches).
const SYSTEM_USER: CurrentUser = {
  id: 'system',
  email: 'system@laheeb.coffee',
  name: 'Scheduled report',
  role: 'OWNER',
  branchId: null,
};

/**
 * Generate the owner/finance report for a fixed window and record that it ran.
 * Email/storage delivery is intentionally a single hook (see TODO) so a provider
 * (Resend, SMTP, object storage) can be dropped in without touching this logic.
 */
export async function runScheduledReport(kind: ReportKind): Promise<{ data: DeckData }> {
  const range = resolveRange({ range: kind === 'weekly' ? '7d' : 'last_month' });
  const periodLabel = `${formatDate(range.start)} → ${formatDate(range.end)}`;
  const filters = parseFilters({});

  const data = await buildDeckData(SYSTEM_USER, filters, {}, range, periodLabel);

  await prisma.auditLog.create({
    data: {
      action: 'SCHEDULED_REPORT',
      entity: kind,
      metadata: {
        period: periodLabel,
        kpis: data.executive,
        reorderAlerts: data.inventory.reorderCount,
        returnRate: data.fulfillment.returnRate,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  // TODO(delivery): email the rendered PDF / persist to object storage here once
  // a provider is configured (e.g. Resend + the /api/reports/deck renderer).

  return { data };
}
