-- Atlas AI Assistant Phase 2 reliability records. All changes are additive;
-- operational records remain authoritative and usable if AI is disabled.

BEGIN;

ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'UPDATE_CUSTOMER';
ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'UPDATE_PARTY';
ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'ADJUST_INVENTORY';
ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'CREATE_ROAST_BATCH';
ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'RECORD_PAYMENT';
ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'RECORD_REFUND';
ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'REVERSE_RECORD';
ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'RECLASSIFY_SPEND';
ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'CREATE_DASHBOARD_DRAFT';
ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'MULTI_ACTION_BUNDLE';
ALTER TYPE "AiPendingActionRisk" ADD VALUE IF NOT EXISTS 'HIGH';

ALTER TABLE "AiPendingAction"
  ADD COLUMN "confirmationChallenge" TEXT,
  ADD COLUMN "confirmationRequestedAt" TIMESTAMP(3);

CREATE TYPE "AiExecutionStatus" AS ENUM ('COMMITTED', 'DOCUMENT_PENDING', 'COMPLETED', 'FAILED');
CREATE TYPE "AiDocumentKind" AS ENUM ('INVOICE', 'PAYMENT_RECEIPT', 'REFUND_RECEIPT', 'FINANCE_VOUCHER', 'INVENTORY_MOVEMENT', 'PRODUCTION_MOVEMENT', 'RECORD_SUMMARY', 'CHANGE_CONFIRMATION', 'REPORT');
CREATE TYPE "AiDocumentStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'FAILED');
CREATE TYPE "AiDeliveryChannel" AS ENUM ('WEB', 'TELEGRAM');
CREATE TYPE "AiDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');
CREATE TYPE "AiAttachmentKind" AS ENUM ('RECEIPT_IMAGE', 'DOCUMENT', 'AUDIO');
CREATE TYPE "AiAttachmentStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'REJECTED');
CREATE TYPE "AiCapabilityStatus" AS ENUM ('ENABLED', 'DISABLED', 'PAUSED');
CREATE TYPE "AiAutomationKind" AS ENUM ('DAILY_SUMMARY', 'ANOMALY_ALERT', 'REORDER_RECOMMENDATION', 'DEMAND_FORECAST');
CREATE TYPE "AiNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "AiExecutionReceipt" (
  "id" TEXT NOT NULL,
  "executionKey" TEXT NOT NULL,
  "pendingActionId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channel" "AiDeliveryChannel" NOT NULL,
  "actionType" "AiPendingActionType" NOT NULL,
  "inputHash" TEXT NOT NULL,
  "status" "AiExecutionStatus" NOT NULL DEFAULT 'COMMITTED',
  "recordType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "linkedRecords" JSONB,
  "auditLogId" TEXT,
  "errorCode" TEXT,
  "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiExecutionReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiDocument" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "conversationId" TEXT,
  "userId" TEXT NOT NULL,
  "kind" "AiDocumentKind" NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "recordType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "status" "AiDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "fileName" TEXT,
  "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
  "byteSize" INTEGER,
  "checksum" TEXT,
  "content" BYTEA,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "generatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiDeliveryOutbox" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "channel" "AiDeliveryChannel" NOT NULL,
  "destination" TEXT NOT NULL,
  "status" "AiDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "externalMessageId" TEXT,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiDeliveryOutbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiAttachment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT,
  "sourceMessageId" TEXT,
  "pendingActionId" TEXT,
  "channel" "AiDeliveryChannel" NOT NULL,
  "kind" "AiAttachmentKind" NOT NULL,
  "status" "AiAttachmentStatus" NOT NULL DEFAULT 'UPLOADED',
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  "telegramFileId" TEXT,
  "extractedText" TEXT,
  "errorCode" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiCapabilitySetting" (
  "capability" TEXT NOT NULL,
  "status" "AiCapabilityStatus" NOT NULL DEFAULT 'ENABLED',
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "failureLimit" INTEGER NOT NULL DEFAULT 1,
  "disabledReason" TEXT,
  "lastFailureAt" TIMESTAMP(3),
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiCapabilitySetting_pkey" PRIMARY KEY ("capability")
);

CREATE TABLE "AiAutomationPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "AiAutomationKind" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "channel" "AiDeliveryChannel" NOT NULL DEFAULT 'WEB',
  "settings" JSONB,
  "nextRunAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiAutomationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiNotificationLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "channel" "AiDeliveryChannel" NOT NULL,
  "status" "AiNotificationStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "externalMessageId" TEXT,
  "errorCode" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiNotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiExecutionReceipt_executionKey_key" ON "AiExecutionReceipt"("executionKey");
CREATE UNIQUE INDEX "AiExecutionReceipt_pendingActionId_key" ON "AiExecutionReceipt"("pendingActionId");
CREATE INDEX "AiExecutionReceipt_conversationId_committedAt_idx" ON "AiExecutionReceipt"("conversationId", "committedAt");
CREATE INDEX "AiExecutionReceipt_userId_committedAt_idx" ON "AiExecutionReceipt"("userId", "committedAt");
CREATE INDEX "AiExecutionReceipt_recordType_recordId_idx" ON "AiExecutionReceipt"("recordType", "recordId");
CREATE INDEX "AiExecutionReceipt_status_updatedAt_idx" ON "AiExecutionReceipt"("status", "updatedAt");

CREATE UNIQUE INDEX "AiDocument_receiptId_kind_locale_key" ON "AiDocument"("receiptId", "kind", "locale");
CREATE INDEX "AiDocument_userId_createdAt_idx" ON "AiDocument"("userId", "createdAt");
CREATE INDEX "AiDocument_recordType_recordId_idx" ON "AiDocument"("recordType", "recordId");
CREATE INDEX "AiDocument_status_updatedAt_idx" ON "AiDocument"("status", "updatedAt");

CREATE UNIQUE INDEX "AiDeliveryOutbox_documentId_channel_destination_key" ON "AiDeliveryOutbox"("documentId", "channel", "destination");
CREATE INDEX "AiDeliveryOutbox_status_availableAt_idx" ON "AiDeliveryOutbox"("status", "availableAt");
CREATE INDEX "AiDeliveryOutbox_receiptId_idx" ON "AiDeliveryOutbox"("receiptId");

CREATE UNIQUE INDEX "AiAttachment_userId_checksum_key" ON "AiAttachment"("userId", "checksum");
CREATE INDEX "AiAttachment_conversationId_createdAt_idx" ON "AiAttachment"("conversationId", "createdAt");
CREATE INDEX "AiAttachment_pendingActionId_idx" ON "AiAttachment"("pendingActionId");
CREATE INDEX "AiAttachment_expiresAt_idx" ON "AiAttachment"("expiresAt");

CREATE UNIQUE INDEX "AiAutomationPreference_userId_kind_channel_key" ON "AiAutomationPreference"("userId", "kind", "channel");
CREATE INDEX "AiAutomationPreference_enabled_nextRunAt_idx" ON "AiAutomationPreference"("enabled", "nextRunAt");

CREATE UNIQUE INDEX "AiNotificationLog_idempotencyKey_key" ON "AiNotificationLog"("idempotencyKey");
CREATE INDEX "AiNotificationLog_status_createdAt_idx" ON "AiNotificationLog"("status", "createdAt");
CREATE INDEX "AiNotificationLog_userId_createdAt_idx" ON "AiNotificationLog"("userId", "createdAt");

ALTER TABLE "AiExecutionReceipt" ADD CONSTRAINT "AiExecutionReceipt_pendingActionId_fkey" FOREIGN KEY ("pendingActionId") REFERENCES "AiPendingAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiExecutionReceipt" ADD CONSTRAINT "AiExecutionReceipt_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiExecutionReceipt" ADD CONSTRAINT "AiExecutionReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiDocument" ADD CONSTRAINT "AiDocument_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "AiExecutionReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiDocument" ADD CONSTRAINT "AiDocument_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiDocument" ADD CONSTRAINT "AiDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiDeliveryOutbox" ADD CONSTRAINT "AiDeliveryOutbox_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "AiExecutionReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiDeliveryOutbox" ADD CONSTRAINT "AiDeliveryOutbox_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "AiDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiAttachment" ADD CONSTRAINT "AiAttachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiAttachment" ADD CONSTRAINT "AiAttachment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiAttachment" ADD CONSTRAINT "AiAttachment_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "AiMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiAttachment" ADD CONSTRAINT "AiAttachment_pendingActionId_fkey" FOREIGN KEY ("pendingActionId") REFERENCES "AiPendingAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiAutomationPreference" ADD CONSTRAINT "AiAutomationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiNotificationLog" ADD CONSTRAINT "AiNotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "defaultFinanceAccountId" TEXT;
CREATE INDEX "User_defaultFinanceAccountId_idx" ON "User"("defaultFinanceAccountId");
ALTER TABLE "User" ADD CONSTRAINT "User_defaultFinanceAccountId_fkey" FOREIGN KEY ("defaultFinanceAccountId") REFERENCES "FinanceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
