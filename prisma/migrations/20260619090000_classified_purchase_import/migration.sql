ALTER TYPE "InventoryCategory" ADD VALUE IF NOT EXISTS 'PRODUCTION_SUPPLY';

DROP INDEX IF EXISTS "FixedAsset_financeEntryId_key";
CREATE INDEX IF NOT EXISTS "FixedAsset_financeEntryId_idx" ON "FixedAsset"("financeEntryId");

ALTER TABLE "FixedAsset" ADD COLUMN IF NOT EXISTS "importKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "FixedAsset_importKey_key" ON "FixedAsset"("importKey");
