import { afterEach, describe, expect, it, vi } from 'vitest';

const processAiDocumentJob = vi.hoisted(() => vi.fn(async () => undefined));
const processAiReportNotification = vi.hoisted(() => vi.fn(async () => {
  throw new Error('telegram_api_500');
}));
const documentCount = vi.hoisted(() => vi.fn());
const notificationCount = vi.hoisted(() => vi.fn());
const automationCount = vi.hoisted(() => vi.fn());
const documentFindMany = vi.hoisted(() => vi.fn(async () => [{ id: 'document-1' }]));
const notificationFindMany = vi.hoisted(() => vi.fn(async () => [{ id: 'report-delivery-1' }]));
const auditCreate = vi.hoisted(() => vi.fn(async () => ({ id: 'audit-1' })));

vi.mock('@/server/db/client', () => ({
  prisma: {
    aiDocument: {
      count: documentCount,
      updateMany: vi.fn(async () => ({ count: 0 })),
      findMany: documentFindMany,
    },
    aiDeliveryOutbox: { updateMany: vi.fn(async () => ({ count: 1 })) },
    aiNotificationLog: {
      count: notificationCount,
      updateMany: vi.fn(async () => ({ count: 1 })),
      findMany: notificationFindMany,
    },
    aiAutomationPreference: { count: automationCount },
    auditLog: { create: auditCreate },
  },
}));
vi.mock('@/server/ai/documents', () => ({ processAiDocumentJob }));
vi.mock('@/server/ai/reports', () => ({ processAiReportNotification }));

import { aiDeliveryStatusText, getUserAiDeliveryHealth, replayUserAiDeliveries } from '@/server/ai/deliveries';

afterEach(() => {
  vi.clearAllMocks();
});

describe('AI delivery health and replay', () => {
  it('summarizes only the requesting user delivery state', async () => {
    documentCount.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    notificationCount.mockResolvedValueOnce(3).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    automationCount.mockResolvedValueOnce(4);

    const health = await getUserAiDeliveryHealth('user-1');

    expect(health).toEqual({
      pendingDocuments: 2,
      failedDocuments: 1,
      pendingReports: 3,
      failedReports: 2,
      failedAutomations: 1,
      enabledAutomations: 4,
      retryable: 3,
    });
    expect(documentCount).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) }));
    expect(notificationCount).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) }));
    expect(aiDeliveryStatusText(health, 'en')).toContain('Deliveries available to retry: 3');
    expect(aiDeliveryStatusText(health, 'ar')).toContain('عمليات تسليم قابلة لإعادة المحاولة: 3');
  });

  it('replays user-owned work, records partial failure, and never selects another user', async () => {
    const result = await replayUserAiDeliveries({ userId: 'user-1', limit: 10 });

    expect(result).toEqual({ attempted: 2, completed: 1, failed: 1 });
    expect(processAiDocumentJob).toHaveBeenCalledWith('document-1');
    expect(processAiReportNotification).toHaveBeenCalledWith('report-delivery-1');
    expect(documentFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) }));
    expect(notificationFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user-1',
        action: 'AI_DELIVERY_REPLAY_REQUESTED',
        metadata: { attempted: 2, completed: 1, failed: 1 },
      }),
    }));
  });
});
