UPDATE "FinanceEntry"
SET "recordClass" = 'EXPENSE'
WHERE
  type = 'EXPENSE'
  AND "costRole" IN ('DIRECT_DELIVERY', 'PAYMENT_PROCESSING')
  AND "recordClass" IS NULL;

UPDATE "LedgerEntryLine"
SET "assetKey" = 'DOC000169'
WHERE
  "financeEntryId" IN (
    SELECT id FROM "FinanceEntry" WHERE "recordKey" = 'DOC000169'
  )
  AND "itemType" = 'ASSET';

UPDATE "FixedAsset"
SET
  "importKey" = 'ASSET:HISTORICAL_SPEND:DOC000169',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "financeEntryId" IN (
    SELECT id FROM "FinanceEntry" WHERE "recordKey" = 'DOC000169'
  )
  AND "importKey" = 'ASSET:DOC000169';

INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", metadata)
SELECT
  'audit-align-simplified-finance-integrity-20260728',
  owner_user.id,
  'ALIGN_FINANCE_INTEGRITY',
  'FinanceEntry',
  entry.id,
  jsonb_build_object(
    'recordKey', 'DOC000169',
    'assetKey', 'DOC000169',
    'assetImportKey', 'ASSET:HISTORICAL_SPEND:DOC000169',
    'directFeesClassified', (
      SELECT count(*)
      FROM "FinanceEntry"
      WHERE
        type = 'EXPENSE'
        AND "costRole" IN ('DIRECT_DELIVERY', 'PAYMENT_PROCESSING')
        AND "recordClass" = 'EXPENSE'
    )
  )
FROM "FinanceEntry" entry
CROSS JOIN LATERAL (
  SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1
) owner_user
WHERE entry."recordKey" = 'DOC000169'
ON CONFLICT (id) DO NOTHING;

SELECT 1 / CASE
  WHEN EXISTS (
    SELECT 1
    FROM "FinanceEntry"
    WHERE
      type = 'EXPENSE'
      AND "costRole" IN ('DIRECT_DELIVERY', 'PAYMENT_PROCESSING')
      AND "recordClass" IS NULL
  ) THEN 0
  WHEN NOT EXISTS (
    SELECT 1 FROM "FinanceEntry" WHERE "recordKey" = 'DOC000169'
  ) THEN 1
  WHEN EXISTS (
    SELECT 1
    FROM "FinanceEntry" entry
    JOIN "LedgerEntryLine" line
      ON line."financeEntryId" = entry.id
      AND line."itemType" = 'ASSET'
      AND line."assetKey" = 'DOC000169'
    JOIN "FixedAsset" asset
      ON asset."financeEntryId" = entry.id
      AND asset."importKey" = 'ASSET:HISTORICAL_SPEND:DOC000169'
      AND asset."totalCost" = line."lineTotal"
    WHERE entry."recordKey" = 'DOC000169'
  ) THEN 1
  ELSE 0
END AS simplified_finance_integrity_alignment;
