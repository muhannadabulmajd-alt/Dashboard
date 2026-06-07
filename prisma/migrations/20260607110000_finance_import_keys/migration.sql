-- Add CAPITAL dataset type for finance imports
ALTER TYPE "DatasetType" ADD VALUE IF NOT EXISTS 'CAPITAL';

-- Idempotency key for bulk finance imports
ALTER TABLE "FinanceEntry" ADD COLUMN "importKey" TEXT;
CREATE UNIQUE INDEX "FinanceEntry_importKey_key" ON "FinanceEntry"("importKey");
