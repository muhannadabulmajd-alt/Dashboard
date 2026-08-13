-- Private Atlas AI Assistant state. All additions are independent of the
-- existing operational paths so the feature can be disabled immediately.

BEGIN;

CREATE TYPE "AiConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');
CREATE TYPE "AiMessageKind" AS ENUM ('TEXT', 'CLARIFICATION', 'RESULT', 'ACTION_PREVIEW', 'SUCCESS', 'ERROR');
CREATE TYPE "AiPendingActionType" AS ENUM ('CREATE_CUSTOMER', 'CREATE_ORDER', 'CREATE_EXPENSE', 'CREATE_PURCHASE', 'UPDATE_ORDER_STATUS');
CREATE TYPE "AiPendingActionRisk" AS ENUM ('MEDIUM');
CREATE TYPE "AiPendingActionStatus" AS ENUM ('PENDING', 'EXECUTING', 'CANCELLED', 'EXECUTED', 'FAILED', 'EXPIRED', 'STALE');
CREATE TYPE "AiRequestStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

ALTER TABLE "Customer" ADD COLUMN "normalizedPhone" TEXT;
ALTER TABLE "Product" ADD COLUMN "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

WITH normalized AS (
  SELECT
    "id",
    regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g') AS digits
  FROM "Customer"
)
UPDATE "Customer" AS customer
SET "normalizedPhone" = CASE
  WHEN normalized.digits = '' THEN NULL
  WHEN normalized.digits LIKE '00964%' THEN '+' || substring(normalized.digits FROM 3)
  WHEN normalized.digits LIKE '964%' THEN '+' || normalized.digits
  WHEN normalized.digits LIKE '0%' THEN '+964' || substring(normalized.digits FROM 2)
  WHEN length(normalized.digits) = 10 THEN '+964' || normalized.digits
  ELSE '+' || normalized.digits
END
FROM normalized
WHERE customer."id" = normalized."id";

CREATE INDEX "Customer_normalizedPhone_idx" ON "Customer"("normalizedPhone");

CREATE TABLE "AiConversation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "title" TEXT,
  "status" "AiConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role" "AiMessageRole" NOT NULL,
  "kind" "AiMessageKind" NOT NULL DEFAULT 'TEXT',
  "content" TEXT,
  "payload" JSONB,
  "model" TEXT,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "requestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiPendingAction" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceMessageId" TEXT,
  "type" "AiPendingActionType" NOT NULL,
  "risk" "AiPendingActionRisk" NOT NULL DEFAULT 'MEDIUM',
  "extractedData" JSONB NOT NULL,
  "validatedData" JSONB,
  "missingFields" JSONB,
  "preview" JSONB NOT NULL,
  "preconditionHash" TEXT NOT NULL,
  "executionKey" TEXT NOT NULL,
  "status" "AiPendingActionStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "executedAt" TIMESTAMP(3),
  "recordType" TEXT,
  "recordId" TEXT,
  "result" JSONB,
  "errorCode" TEXT,
  "debugId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiPendingAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiRequestLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT,
  "model" TEXT NOT NULL,
  "requestId" TEXT,
  "status" "AiRequestStatus" NOT NULL DEFAULT 'PENDING',
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "latencyMs" INTEGER,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiRequestLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiRateLimitBucket" (
  "userId" TEXT NOT NULL,
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiRateLimitBucket_pkey" PRIMARY KEY ("userId", "bucketStart")
);

CREATE UNIQUE INDEX "AiPendingAction_executionKey_key" ON "AiPendingAction"("executionKey");
CREATE UNIQUE INDEX "AiConversation_id_userId_key" ON "AiConversation"("id", "userId");
CREATE UNIQUE INDEX "AiPendingAction_one_pending_per_conversation_key"
  ON "AiPendingAction"("conversationId")
  WHERE "status" = 'PENDING';
CREATE INDEX "AiConversation_userId_lastMessageAt_idx" ON "AiConversation"("userId", "lastMessageAt");
CREATE INDEX "AiConversation_expiresAt_idx" ON "AiConversation"("expiresAt");
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");
CREATE INDEX "AiMessage_requestId_idx" ON "AiMessage"("requestId");
CREATE INDEX "AiPendingAction_conversationId_status_idx" ON "AiPendingAction"("conversationId", "status");
CREATE INDEX "AiPendingAction_userId_status_idx" ON "AiPendingAction"("userId", "status");
CREATE INDEX "AiPendingAction_sourceMessageId_idx" ON "AiPendingAction"("sourceMessageId");
CREATE INDEX "AiPendingAction_expiresAt_idx" ON "AiPendingAction"("expiresAt");
CREATE INDEX "AiRequestLog_userId_createdAt_idx" ON "AiRequestLog"("userId", "createdAt");
CREATE INDEX "AiRequestLog_conversationId_idx" ON "AiRequestLog"("conversationId");
CREATE INDEX "AiRequestLog_requestId_idx" ON "AiRequestLog"("requestId");
CREATE INDEX "AiRateLimitBucket_bucketStart_idx" ON "AiRateLimitBucket"("bucketStart");

ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiPendingAction" ADD CONSTRAINT "AiPendingAction_conversationId_userId_fkey" FOREIGN KEY ("conversationId", "userId") REFERENCES "AiConversation"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiPendingAction" ADD CONSTRAINT "AiPendingAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiPendingAction" ADD CONSTRAINT "AiPendingAction_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "AiMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiRequestLog" ADD CONSTRAINT "AiRequestLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiRequestLog" ADD CONSTRAINT "AiRequestLog_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiRateLimitBucket" ADD CONSTRAINT "AiRateLimitBucket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
