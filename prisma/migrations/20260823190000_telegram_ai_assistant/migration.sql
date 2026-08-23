-- Private Telegram transport for the Atlas AI Assistant. Telegram identities
-- map to Atlas users; short-lived update receipts provide replay protection.

BEGIN;

CREATE TYPE "AiConversationChannel" AS ENUM ('WEB', 'TELEGRAM');
CREATE TYPE "TelegramIdentityStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');
CREATE TYPE "TelegramUpdateStatus" AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'IGNORED');

ALTER TABLE "AiConversation"
  ADD COLUMN "channel" "AiConversationChannel" NOT NULL DEFAULT 'WEB',
  ADD COLUMN "externalThreadId" TEXT;

CREATE TABLE "TelegramIdentity" (
  "id" TEXT NOT NULL,
  "telegramUserId" TEXT NOT NULL,
  "privateChatId" TEXT,
  "userId" TEXT,
  "username" TEXT,
  "firstName" TEXT,
  "lastName" TEXT,
  "languageCode" TEXT,
  "status" "TelegramIdentityStatus" NOT NULL DEFAULT 'PENDING',
  "linkedById" TEXT,
  "linkedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TelegramUpdate" (
  "id" TEXT NOT NULL,
  "updateId" TEXT NOT NULL,
  "identityId" TEXT,
  "telegramUserId" TEXT NOT NULL,
  "privateChatId" TEXT,
  "updateType" TEXT NOT NULL,
  "status" "TelegramUpdateStatus" NOT NULL DEFAULT 'RECEIVED',
  "payload" JSONB NOT NULL,
  "origin" TEXT NOT NULL,
  "replyMessageId" TEXT,
  "conversationId" TEXT,
  "aiMessageId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "debugId" TEXT,
  "queuedAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramUpdate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramIdentity_telegramUserId_key" ON "TelegramIdentity"("telegramUserId");
CREATE UNIQUE INDEX "TelegramIdentity_privateChatId_key" ON "TelegramIdentity"("privateChatId");
CREATE UNIQUE INDEX "TelegramIdentity_userId_key" ON "TelegramIdentity"("userId");
CREATE INDEX "TelegramIdentity_status_createdAt_idx" ON "TelegramIdentity"("status", "createdAt");
CREATE INDEX "TelegramIdentity_linkedById_idx" ON "TelegramIdentity"("linkedById");

CREATE UNIQUE INDEX "TelegramUpdate_updateId_key" ON "TelegramUpdate"("updateId");
CREATE INDEX "TelegramUpdate_status_createdAt_idx" ON "TelegramUpdate"("status", "createdAt");
CREATE INDEX "TelegramUpdate_identityId_createdAt_idx" ON "TelegramUpdate"("identityId", "createdAt");
CREATE INDEX "TelegramUpdate_conversationId_idx" ON "TelegramUpdate"("conversationId");
CREATE INDEX "TelegramUpdate_expiresAt_idx" ON "TelegramUpdate"("expiresAt");

CREATE INDEX "AiConversation_userId_channel_lastMessageAt_idx"
  ON "AiConversation"("userId", "channel", "lastMessageAt");
CREATE INDEX "AiConversation_channel_externalThreadId_status_lastMessageAt_idx"
  ON "AiConversation"("channel", "externalThreadId", "status", "lastMessageAt");

ALTER TABLE "TelegramIdentity"
  ADD CONSTRAINT "TelegramIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TelegramIdentity"
  ADD CONSTRAINT "TelegramIdentity_linkedById_fkey"
  FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TelegramUpdate"
  ADD CONSTRAINT "TelegramUpdate_identityId_fkey"
  FOREIGN KEY ("identityId") REFERENCES "TelegramIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
