ALTER TABLE "LedgerEntryLine"
  ADD COLUMN "assetKey" TEXT,
  ADD COLUMN "assetCategory" TEXT;

UPDATE "LedgerEntryLine" AS line
SET
  "assetKey" = REPLACE(asset."importKey", 'ASSET:HISTORICAL_SPEND:', ''),
  "assetCategory" = asset.category
FROM "FinanceEntry" AS entry, "FixedAsset" AS asset
WHERE line."financeEntryId" = entry.id
  AND line."itemType" = 'ASSET'
  AND asset."importKey" LIKE 'ASSET:HISTORICAL_SPEND:%'
  AND line."itemName" = asset.name
  AND entry.reference IS NOT NULL
  AND asset.notes LIKE '%' || entry.reference || '%';

SET CONSTRAINTS ALL IMMEDIATE;

CREATE INDEX "LedgerEntryLine_assetKey_idx" ON "LedgerEntryLine"("assetKey");
