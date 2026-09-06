ALTER TYPE "AiNotificationStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

CREATE TABLE "AiReportSnapshot" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT,
  "sourceMessageId" TEXT,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "reportType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiReportSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiReportSnapshot_userId_createdAt_idx" ON "AiReportSnapshot"("userId", "createdAt");
CREATE INDEX "AiReportSnapshot_conversationId_createdAt_idx" ON "AiReportSnapshot"("conversationId", "createdAt");
CREATE INDEX "AiReportSnapshot_expiresAt_idx" ON "AiReportSnapshot"("expiresAt");

ALTER TABLE "AiReportSnapshot" ADD CONSTRAINT "AiReportSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiReportSnapshot" ADD CONSTRAINT "AiReportSnapshot_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiReportSnapshot" ADD CONSTRAINT "AiReportSnapshot_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "AiMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX "AiNotificationLog_status_createdAt_idx";
ALTER TABLE "AiNotificationLog"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3);
CREATE INDEX "AiNotificationLog_status_availableAt_idx" ON "AiNotificationLog"("status", "availableAt");
