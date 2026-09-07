import 'server-only';

import { prisma } from '@/server/db/client';
import { processAiDocumentJob } from './documents';
import { processAiReportNotification } from './reports';

export type AiDeliveryHealth = {
  pendingDocuments: number;
  failedDocuments: number;
  pendingReports: number;
  failedReports: number;
  failedAutomations: number;
  enabledAutomations: number;
  retryable: number;
};

export async function getUserAiDeliveryHealth(userId: string): Promise<AiDeliveryHealth> {
  const [pendingDocuments, failedDocuments, pendingReports, failedReports, failedAutomations, enabledAutomations] = await Promise.all([
    prisma.aiDocument.count({
      where: {
        userId,
        OR: [
          { status: { in: ['PENDING', 'GENERATING'] } },
          { deliveries: { some: { status: { in: ['PENDING', 'PROCESSING'] } } } },
        ],
      },
    }),
    prisma.aiDocument.count({
      where: {
        userId,
        OR: [
          { status: 'FAILED' },
          { deliveries: { some: { status: 'FAILED' } } },
        ],
      },
    }),
    prisma.aiNotificationLog.count({
      where: { userId, kind: 'AI_REPORT', status: { in: ['PENDING', 'PROCESSING'] } },
    }),
    prisma.aiNotificationLog.count({ where: { userId, kind: 'AI_REPORT', status: 'FAILED' } }),
    prisma.aiNotificationLog.count({ where: { userId, kind: 'AI_AUTOMATION_RUN', status: 'FAILED' } }),
    prisma.aiAutomationPreference.count({ where: { userId, enabled: true } }),
  ]);
  return {
    pendingDocuments,
    failedDocuments,
    pendingReports,
    failedReports,
    failedAutomations,
    enabledAutomations,
    retryable: failedDocuments + failedReports,
  };
}

export async function replayUserAiDeliveries(input: {
  userId: string;
  limit?: number;
}): Promise<{ attempted: number; completed: number; failed: number }> {
  const now = new Date();
  const limit = Math.max(1, Math.min(20, input.limit ?? 10));
  const staleAt = new Date(now.getTime() - 10 * 60_000);
  await Promise.all([
    prisma.aiDocument.updateMany({
      where: { userId: input.userId, status: 'GENERATING', updatedAt: { lt: staleAt } },
      data: { status: 'FAILED', errorCode: 'document_generation_interrupted' },
    }),
    prisma.aiDeliveryOutbox.updateMany({
      where: {
        receipt: { userId: input.userId },
        OR: [
          { status: 'FAILED' },
          { status: 'PROCESSING', lastAttemptAt: { lt: staleAt } },
        ],
      },
      data: { status: 'FAILED', availableAt: now, errorCode: 'delivery_replay_requested' },
    }),
    prisma.aiNotificationLog.updateMany({
      where: { userId: input.userId, kind: 'AI_REPORT', status: 'FAILED' },
      data: { availableAt: now },
    }),
  ]);
  const [documents, reports] = await Promise.all([
    prisma.aiDocument.findMany({
      where: {
        userId: input.userId,
        OR: [
          { status: { in: ['PENDING', 'FAILED'] } },
          { deliveries: { some: { status: { in: ['PENDING', 'FAILED'] }, availableAt: { lte: now } } } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: { id: true },
    }),
    prisma.aiNotificationLog.findMany({
      where: {
        userId: input.userId,
        kind: 'AI_REPORT',
        OR: [
          { status: { in: ['PENDING', 'FAILED'] }, availableAt: { lte: now } },
          { status: 'PROCESSING', lastAttemptAt: { lt: staleAt } },
        ],
      },
      orderBy: { availableAt: 'asc' },
      take: limit,
      select: { id: true },
    }),
  ]);
  const jobs = [
    ...documents.map((document) => () => processAiDocumentJob(document.id)),
    ...reports.slice(0, Math.max(0, limit - documents.length)).map((report) => () => processAiReportNotification(report.id)),
  ];
  let completed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await job();
      completed += 1;
    } catch {
      failed += 1;
    }
  }
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: 'AI_DELIVERY_REPLAY_REQUESTED',
      entity: 'User',
      entityId: input.userId,
      metadata: { attempted: jobs.length, completed, failed },
    },
  });
  return { attempted: jobs.length, completed, failed };
}

export function aiDeliveryStatusText(health: AiDeliveryHealth, locale: 'ar' | 'en'): string {
  if (locale === 'ar') {
    return [
      'حالة مساعد أطلس',
      `الأتمتة المفعلة: ${health.enabledAutomations}`,
      `مستندات قيد التجهيز: ${health.pendingDocuments}`,
      `تقارير قيد الإرسال: ${health.pendingReports}`,
      `عمليات تسليم قابلة لإعادة المحاولة: ${health.retryable}`,
      `أتمتة تحتاج مراجعة: ${health.failedAutomations}`,
    ].join('\n');
  }
  return [
    'Atlas AI status',
    `Enabled automations: ${health.enabledAutomations}`,
    `Documents being prepared: ${health.pendingDocuments}`,
    `Reports being delivered: ${health.pendingReports}`,
    `Deliveries available to retry: ${health.retryable}`,
    `Automations needing review: ${health.failedAutomations}`,
  ].join('\n');
}
