CREATE TYPE "LedgerRecordClass" AS ENUM ('PURCHASE', 'EXPENSE', 'MIXED');

ALTER TABLE "FinanceEntry" ADD COLUMN "recordClass" "LedgerRecordClass";

UPDATE "FinanceEntry" AS entry
SET "recordClass" = CASE
  WHEN entry.type = 'EXPENSE' THEN 'EXPENSE'::"LedgerRecordClass"
  WHEN entry.type = 'PURCHASE' AND EXISTS (
    SELECT 1 FROM "LedgerEntryLine" line
    WHERE line."financeEntryId" = entry.id
      AND line."itemType" IN ('INVENTORY', 'ASSET')
  ) AND EXISTS (
    SELECT 1 FROM "LedgerEntryLine" line
    WHERE line."financeEntryId" = entry.id
      AND line."itemType" IN ('EXPENSE', 'SERVICE', 'OTHER')
  ) THEN 'MIXED'::"LedgerRecordClass"
  WHEN entry.type = 'PURCHASE' AND EXISTS (
    SELECT 1 FROM "LedgerEntryLine" line
    WHERE line."financeEntryId" = entry.id
      AND line."itemType" IN ('EXPENSE', 'SERVICE', 'OTHER')
  ) THEN 'EXPENSE'::"LedgerRecordClass"
  WHEN entry.type = 'PURCHASE' THEN 'PURCHASE'::"LedgerRecordClass"
  ELSE entry."recordClass"
END
WHERE entry.type IN ('EXPENSE', 'PURCHASE');

INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", metadata, "createdAt")
SELECT
  'reclass_' || md5(entry.id),
  NULL,
  'RECLASSIFY',
  'FinanceEntry',
  entry.id,
  jsonb_build_object(
    'source', '20260619130000_importer_ledger_classification',
    'previousClass', NULL,
    'recordClass', entry."recordClass"
  ),
  CURRENT_TIMESTAMP
FROM "FinanceEntry" entry
WHERE entry."importKey" LIKE 'PUR:HISTORICAL_SPEND:%';

CREATE INDEX "FinanceEntry_recordClass_idx" ON "FinanceEntry"("recordClass");
