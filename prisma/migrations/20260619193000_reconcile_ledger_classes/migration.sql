CREATE OR REPLACE FUNCTION sync_finance_entry_record_class(target_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE "FinanceEntry" e
  SET "recordClass" = CASE
    WHEN e.type = 'EXPENSE' THEN 'EXPENSE'::"LedgerRecordClass"
    WHEN EXISTS (
      SELECT 1 FROM "LedgerEntryLine" l
      WHERE l."financeEntryId" = e.id AND l."itemType" IN ('INVENTORY', 'ASSET')
    ) AND EXISTS (
      SELECT 1 FROM "LedgerEntryLine" l
      WHERE l."financeEntryId" = e.id AND l."itemType" IN ('EXPENSE', 'SERVICE', 'OTHER')
    ) THEN 'MIXED'::"LedgerRecordClass"
    WHEN EXISTS (
      SELECT 1 FROM "LedgerEntryLine" l
      WHERE l."financeEntryId" = e.id AND l."itemType" IN ('EXPENSE', 'SERVICE', 'OTHER')
    ) THEN 'EXPENSE'::"LedgerRecordClass"
    ELSE 'PURCHASE'::"LedgerRecordClass"
  END
  WHERE e.id = target_id AND e.type IN ('EXPENSE', 'PURCHASE');
END;
$$ LANGUAGE plpgsql;

INSERT INTO "AuditLog" (id, action, entity, "entityId", metadata, "createdAt")
SELECT
  'audit_reclass_' || e.id,
  'DATA_REPAIR',
  'FinanceEntry',
  e.id,
  jsonb_build_object(
    'migration', '20260619193000_reconcile_ledger_classes',
    'reason', 'Reconciled umbrella classification with ledger line types',
    'beforeRecordClass', e."recordClass",
    'lineTypes', COALESCE((
      SELECT jsonb_agg(l."itemType" ORDER BY l."lineNo")
      FROM "LedgerEntryLine" l WHERE l."financeEntryId" = e.id
    ), '[]'::jsonb)
  ),
  NOW()
FROM "FinanceEntry" e
WHERE e.type IN ('EXPENSE', 'PURCHASE')
  AND e."recordClass" IS DISTINCT FROM CASE
    WHEN e.type = 'EXPENSE' THEN 'EXPENSE'::"LedgerRecordClass"
    WHEN EXISTS (
      SELECT 1 FROM "LedgerEntryLine" l
      WHERE l."financeEntryId" = e.id AND l."itemType" IN ('INVENTORY', 'ASSET')
    ) AND EXISTS (
      SELECT 1 FROM "LedgerEntryLine" l
      WHERE l."financeEntryId" = e.id AND l."itemType" IN ('EXPENSE', 'SERVICE', 'OTHER')
    ) THEN 'MIXED'::"LedgerRecordClass"
    WHEN EXISTS (
      SELECT 1 FROM "LedgerEntryLine" l
      WHERE l."financeEntryId" = e.id AND l."itemType" IN ('EXPENSE', 'SERVICE', 'OTHER')
    ) THEN 'EXPENSE'::"LedgerRecordClass"
    ELSE 'PURCHASE'::"LedgerRecordClass"
  END
ON CONFLICT (id) DO NOTHING;

UPDATE "FinanceEntry" e
SET "recordClass" = CASE
  WHEN e.type = 'EXPENSE' THEN 'EXPENSE'::"LedgerRecordClass"
  WHEN EXISTS (
    SELECT 1 FROM "LedgerEntryLine" l
    WHERE l."financeEntryId" = e.id AND l."itemType" IN ('INVENTORY', 'ASSET')
  ) AND EXISTS (
    SELECT 1 FROM "LedgerEntryLine" l
    WHERE l."financeEntryId" = e.id AND l."itemType" IN ('EXPENSE', 'SERVICE', 'OTHER')
  ) THEN 'MIXED'::"LedgerRecordClass"
  WHEN EXISTS (
    SELECT 1 FROM "LedgerEntryLine" l
    WHERE l."financeEntryId" = e.id AND l."itemType" IN ('EXPENSE', 'SERVICE', 'OTHER')
  ) THEN 'EXPENSE'::"LedgerRecordClass"
  ELSE 'PURCHASE'::"LedgerRecordClass"
END
WHERE e.type IN ('EXPENSE', 'PURCHASE');

CREATE OR REPLACE FUNCTION sync_ledger_line_record_class_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD."financeEntryId" IS DISTINCT FROM NEW."financeEntryId") THEN
    PERFORM sync_finance_entry_record_class(OLD."financeEntryId");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM sync_finance_entry_record_class(NEW."financeEntryId");
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "LedgerEntryLine_sync_record_class" ON "LedgerEntryLine";
CREATE TRIGGER "LedgerEntryLine_sync_record_class"
AFTER INSERT OR UPDATE OR DELETE ON "LedgerEntryLine"
FOR EACH ROW EXECUTE FUNCTION sync_ledger_line_record_class_trigger();
