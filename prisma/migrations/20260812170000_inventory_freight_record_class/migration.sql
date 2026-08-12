BEGIN;

-- The five owner-approved transfer-freight lines are inventory acquisition
-- costs awaiting item-level allocation, not operating services. Updating the
-- line type also drives the existing record-class trigger back to PURCHASE.
UPDATE "LedgerEntryLine" line
SET "itemType" = 'INVENTORY'
FROM "FinanceEntry" entry
WHERE entry.id = line."financeEntryId"
  AND entry."importKey" = 'EXTREP:20260812:HI:FREIGHT:AP'
  AND line."spendTreatment" = 'INVENTORY'
  AND line."itemType" IS DISTINCT FROM 'INVENTORY';

DO $$
DECLARE
  failures integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Setting"
    WHERE key = 'external_reports_reconciliation_version'
      AND value = '2026-08-12-v1'
  ) THEN
    RETURN;
  END IF;

  SELECT count(*) INTO failures
  FROM "LedgerEntryLine" line
  JOIN "FinanceEntry" entry ON entry.id = line."financeEntryId"
  WHERE entry."importKey" = 'EXTREP:20260812:HI:FREIGHT:AP'
    AND (
      line."itemType" <> 'INVENTORY'
      OR line."spendTreatment" <> 'INVENTORY'
      OR entry."recordClass" <> 'PURCHASE'
    );

  IF failures <> 0 OR (
    SELECT count(*) FROM "LedgerEntryLine" line
    JOIN "FinanceEntry" entry ON entry.id = line."financeEntryId"
    WHERE entry."importKey" = 'EXTREP:20260812:HI:FREIGHT:AP'
  ) <> 5 THEN
    RAISE EXCEPTION 'Inventory-transfer freight classification repair failed';
  END IF;
END $$;

INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", metadata, "createdAt")
SELECT
  'audit-inventory-freight-record-class-20260812-v1',
  (SELECT id FROM "User" WHERE role IN ('OWNER', 'ADMIN') ORDER BY "createdAt" LIMIT 1),
  'DATA_REPAIR',
  'FinanceEntry',
  entry.id,
  jsonb_build_object(
    'reason', 'Inventory-transfer freight is an inventory acquisition cost, not an operating service',
    'amount', entry.amount,
    'lineCount', 5,
    'beforeItemType', 'SERVICE',
    'afterItemType', 'INVENTORY',
    'recordClass', entry."recordClass"
  ),
  CURRENT_TIMESTAMP
FROM "FinanceEntry" entry
WHERE entry."importKey" = 'EXTREP:20260812:HI:FREIGHT:AP'
ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata;

COMMIT;
