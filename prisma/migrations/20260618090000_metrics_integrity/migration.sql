-- Keep the entered base unit price and the final landed cost as separate facts.
ALTER TABLE "LedgerEntryLine" ADD COLUMN "landedUnitCost" DECIMAL(14,3);
UPDATE "LedgerEntryLine" SET "landedUnitCost" = "unitCost";
ALTER TABLE "LedgerEntryLine" ALTER COLUMN "landedUnitCost" SET NOT NULL;

ALTER TABLE "ListOption" ADD COLUMN "metricRole" TEXT;
INSERT INTO "ListOption" (
  "id", "listKey", "code", "labelEn", "labelAr", "sortOrder",
  "isActive", "isSystem", "metricRole", "createdAt", "updatedAt"
)
VALUES
  ('metric-status-pending', 'orderStatus', 'PENDING', 'Pending', 'قيد الانتظار', 0, true, true, 'OPEN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('metric-status-completed', 'orderStatus', 'COMPLETED', 'Completed', 'مكتمل', 1, true, true, 'SALE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('metric-status-cancelled', 'orderStatus', 'CANCELLED', 'Cancelled', 'ملغى', 2, true, true, 'CANCELED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('metric-status-returned', 'orderStatus', 'RETURNED', 'Returned', 'مرتجع', 3, true, true, 'RETURN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('metric-status-refunded', 'orderStatus', 'REFUNDED', 'Refunded', 'مسترد', 4, true, true, 'RETURN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("listKey", "code") DO UPDATE SET "metricRole" = EXCLUDED."metricRole";

-- Audit every mismatch before repair. The latest parent amount is authoritative.
INSERT INTO "AuditLog" ("id", "action", "entity", "entityId", "metadata", "createdAt")
SELECT
  'reconcile-' || md5(e."id" || clock_timestamp()::text),
  'RECONCILE',
  'FinanceEntry',
  e."id",
  jsonb_build_object(
    'reason', 'ledger-line-parent-total-mismatch',
    'parentAmount', e."amount",
    'lineTotalBefore', SUM(l."lineTotal"),
    'source', '20260618090000_metrics_integrity'
  ),
  CURRENT_TIMESTAMP
FROM "FinanceEntry" e
JOIN "LedgerEntryLine" l ON l."financeEntryId" = e."id"
GROUP BY e."id", e."amount"
HAVING SUM(l."lineTotal") <> e."amount";

-- Proportionally scale old lines. The final line receives the integer remainder.
WITH totals AS (
  SELECT e."id", e."amount", SUM(l."lineTotal") AS old_total
  FROM "FinanceEntry" e
  JOIN "LedgerEntryLine" l ON l."financeEntryId" = e."id"
  GROUP BY e."id", e."amount"
  HAVING SUM(l."lineTotal") <> e."amount" AND SUM(l."lineTotal") > 0
), scaled AS (
  SELECT
    l."id", l."financeEntryId", l."quantity", t."amount", t.old_total,
    ROUND(l."lineTotal"::numeric * t."amount" / t.old_total)::integer AS rounded_total,
    ROUND(l."discountAmount"::numeric * t."amount" / t.old_total)::integer AS scaled_discount,
    ROUND(l."extraAmount"::numeric * t."amount" / t.old_total)::integer AS scaled_extra,
    ROW_NUMBER() OVER (PARTITION BY l."financeEntryId" ORDER BY l."lineNo" DESC) AS reverse_no,
    SUM(ROUND(l."lineTotal"::numeric * t."amount" / t.old_total)::integer)
      OVER (PARTITION BY l."financeEntryId") AS rounded_sum
  FROM "LedgerEntryLine" l
  JOIN totals t ON t."id" = l."financeEntryId"
), exact AS (
  SELECT *, rounded_total + CASE WHEN reverse_no = 1 THEN amount - rounded_sum ELSE 0 END AS exact_total
  FROM scaled
)
UPDATE "LedgerEntryLine" l
SET
  "lineTotal" = x.exact_total,
  "discountAmount" = GREATEST(0, x.scaled_discount),
  "extraAmount" = GREATEST(0, x.scaled_extra),
  "unitCost" = ROUND(l."unitCost" * x.amount / x.old_total, 3),
  "landedUnitCost" = ROUND(x.exact_total::numeric / NULLIF(x."quantity", 0), 3)
FROM exact x
WHERE l."id" = x."id";

UPDATE "InventoryCostLayer" c
SET "unitCost" = l."landedUnitCost"
FROM "LedgerEntryLine" l
WHERE l."financeEntryId" = c."financeEntryId"
  AND l."inventoryItemId" = c."inventoryItemId";

CREATE UNIQUE INDEX "LedgerEntryLine_financeEntryId_lineNo_key"
  ON "LedgerEntryLine"("financeEntryId", "lineNo");

ALTER TABLE "LedgerEntryLine"
  ADD CONSTRAINT "LedgerEntryLine_lineNo_check" CHECK ("lineNo" > 0),
  ADD CONSTRAINT "LedgerEntryLine_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "LedgerEntryLine_unitCost_check" CHECK ("unitCost" >= 0),
  ADD CONSTRAINT "LedgerEntryLine_landedUnitCost_check" CHECK ("landedUnitCost" >= 0),
  ADD CONSTRAINT "LedgerEntryLine_lineTotal_check" CHECK ("lineTotal" >= 0),
  ADD CONSTRAINT "LedgerEntryLine_discountAmount_check" CHECK ("discountAmount" >= 0),
  ADD CONSTRAINT "LedgerEntryLine_extraAmount_check" CHECK ("extraAmount" >= 0);

CREATE OR REPLACE FUNCTION check_finance_ledger_total_for_parent(target_id TEXT) RETURNS void AS $$
DECLARE parent_amount INTEGER; child_amount BIGINT;
BEGIN
  SELECT "amount" INTO parent_amount FROM "FinanceEntry" WHERE "id" = target_id;
  IF parent_amount IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM("lineTotal"), 0) INTO child_amount
  FROM "LedgerEntryLine" WHERE "financeEntryId" = target_id;
  IF child_amount <> parent_amount THEN
    RAISE EXCEPTION 'FinanceEntry % amount % does not equal ledger line total %', target_id, parent_amount, child_amount;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_finance_ledger_total() RETURNS trigger AS $$
BEGIN
  PERFORM check_finance_ledger_total_for_parent(COALESCE(NEW."financeEntryId", OLD."financeEntryId"));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_finance_parent_total() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "LedgerEntryLine" WHERE "financeEntryId" = NEW."id") THEN
    PERFORM check_finance_ledger_total_for_parent(NEW."id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "FinanceEntry_ledger_total_check"
AFTER INSERT OR UPDATE OR DELETE ON "LedgerEntryLine"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_finance_ledger_total();

CREATE CONSTRAINT TRIGGER "FinanceEntry_parent_total_check"
AFTER UPDATE OF "amount" ON "FinanceEntry"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD."amount" IS DISTINCT FROM NEW."amount")
EXECUTE FUNCTION check_finance_parent_total();
