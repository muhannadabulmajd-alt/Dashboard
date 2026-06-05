import 'server-only';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { Prisma } from '@prisma/client';
import { resolveRange, formatDate } from '@/lib/dates';
import { parseFilters } from '@/lib/filters';
import type { CurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';
import { buildDeckData, type DeckData } from './deck-data';
import { Deck } from './Deck';
import { sendEmail, getReportRecipients, type EmailResult } from './email';

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
export async function runScheduledReport(
  kind: ReportKind,
  opts: { deliver?: boolean } = {},
): Promise<{ data: DeckData; delivery?: EmailResult }> {
  const range = resolveRange({ range: kind === 'weekly' ? '7d' : 'last_month' });
  const periodLabel = `${formatDate(range.start)} → ${formatDate(range.end)}`;
  const filters = parseFilters({});

  const data = await buildDeckData(SYSTEM_USER, filters, {}, range, periodLabel);

  let delivery: EmailResult | undefined;
  if (opts.deliver) {
    const element = createElement(Deck, { data }) as Parameters<typeof renderToBuffer>[0];
    const buffer = await renderToBuffer(element);
    const to = await getReportRecipients();
    delivery = await sendEmail({
      to,
      subject: `Laheeb ${kind === 'weekly' ? 'weekly' : 'monthly'} report — ${periodLabel}`,
      text: `Attached is the ${kind} management report for ${periodLabel}.`,
      attachments: [{ filename: `laheeb-${kind}-report.pdf`, content: buffer }],
    });
  }

  await prisma.auditLog.create({
    data: {
      action: 'SCHEDULED_REPORT',
      entity: kind,
      metadata: {
        period: periodLabel,
        kpis: data.executive,
        reorderAlerts: data.inventory.reorderCount,
        returnRate: data.fulfillment.returnRate,
        delivery: delivery
          ? { provider: delivery.provider, delivered: delivery.delivered, to: delivery.to }
          : null,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return { data, delivery };
}
