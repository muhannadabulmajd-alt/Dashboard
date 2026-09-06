import { NextResponse, type NextRequest } from 'next/server';
import { getAiAssistantConfig } from '@/server/ai/config';
import { replayDueAiDocuments } from '@/server/ai/documents';
import { replayDueAiReports } from '@/server/ai/reports';
import { prisma } from '@/server/db/client';
import { isCronAuthorized } from '@/server/http/cron';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });
  const now = new Date();
  const retentionCutoff = new Date(now);
  retentionCutoff.setUTCDate(retentionCutoff.getUTCDate() - getAiAssistantConfig().historyRetentionDays);
  const bucketCutoff = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1_000);
  const interruptedRequestCutoff = new Date(now.getTime() - 10 * 60_000);

  const result = await prisma.$transaction(async (tx) => {
    const expirable = await tx.aiPendingAction.findMany({
      where: {
        OR: [
          { status: 'PENDING', expiresAt: { lte: now } },
          {
            status: 'EXECUTING',
            expiresAt: { lte: now },
            updatedAt: { lt: new Date(now.getTime() - 2 * 60_000) },
          },
        ],
      },
      select: { id: true, userId: true, conversationId: true, type: true, status: true },
    });
    let expiredActions = 0;
    for (const action of expirable) {
      const expired = await tx.aiPendingAction.updateMany({
        where: { id: action.id, status: action.status },
        data: { status: 'EXPIRED', errorCode: 'expired' },
      });
      if (expired.count !== 1) continue;
      expiredActions += 1;
      await tx.auditLog.create({
        data: {
          userId: action.userId,
          action: 'AI_ACTION_EXPIRED',
          entity: 'AiPendingAction',
          entityId: action.id,
          metadata: {
            actionType: action.type,
            conversationId: action.conversationId,
            previousStatus: action.status,
            source: 'retention-cron',
          },
        },
      });
    }

    const interruptedRequests = await tx.aiRequestLog.updateMany({
      where: { status: 'PENDING', createdAt: { lt: interruptedRequestCutoff } },
      data: { status: 'FAILED', errorCode: 'request_interrupted' },
    });
    const conversations = await tx.aiConversation.deleteMany({ where: { expiresAt: { lte: now } } });
    const requestLogs = await tx.aiRequestLog.deleteMany({ where: { createdAt: { lt: retentionCutoff } } });
    const buckets = await tx.aiRateLimitBucket.deleteMany({ where: { bucketStart: { lt: bucketCutoff } } });
    const telegramUpdates = await tx.telegramUpdate.deleteMany({ where: { expiresAt: { lte: now } } });
    const attachments = await tx.aiAttachment.deleteMany({ where: { expiresAt: { lte: now } } });
    const reportSnapshots = await tx.aiReportSnapshot.deleteMany({ where: { expiresAt: { lte: now } } });
    const notifications = await tx.aiNotificationLog.deleteMany({
      where: { createdAt: { lt: retentionCutoff }, status: { in: ['SENT', 'SKIPPED'] } },
    });
    return {
      expiredActions,
      interruptedRequests,
      conversations,
      requestLogs,
      buckets,
      telegramUpdates,
      attachments,
      reportSnapshots,
      notifications,
    };
  });
  const [documents, reports] = await Promise.all([
    replayDueAiDocuments(10),
    replayDueAiReports(10),
  ]);

  return NextResponse.json({
    ok: true,
    expiredActions: result.expiredActions,
    interruptedRequests: result.interruptedRequests.count,
    conversationsDeleted: result.conversations.count,
    requestLogsDeleted: result.requestLogs.count,
    rateLimitBucketsDeleted: result.buckets.count,
    telegramUpdatesDeleted: result.telegramUpdates.count,
    attachmentsDeleted: result.attachments.count,
    reportSnapshotsDeleted: result.reportSnapshots.count,
    notificationLogsDeleted: result.notifications.count,
    documentDeliveriesReplayed: documents.processed,
    reportDeliveriesReplayed: reports.processed,
  });
}
