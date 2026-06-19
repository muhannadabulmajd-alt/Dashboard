-- Stable import references, historical stock policy, and linked roast production.
ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'PRODUCTION_OUT';

CREATE TYPE "InventorySyncMode" AS ENUM ('NORMAL', 'SKIP_HISTORICAL');

ALTER TABLE "Order"
  ADD COLUMN "inventorySyncMode" "InventorySyncMode" NOT NULL DEFAULT 'NORMAL';

ALTER TABLE "FinanceAccount" ADD COLUMN "externalKey" TEXT;
ALTER TABLE "Party" ADD COLUMN "externalKey" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "externalKey" TEXT;

ALTER TABLE "RoastBatch"
  ADD COLUMN "greenInventoryItemId" TEXT,
  ADD COLUMN "roastedInventoryItemId" TEXT;

ALTER TABLE "InventoryCostLayer" ADD COLUMN "roastBatchId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "roastBatchId" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "courierPartyId" TEXT;

CREATE UNIQUE INDEX "FinanceAccount_externalKey_key" ON "FinanceAccount"("externalKey");
CREATE UNIQUE INDEX "Party_externalKey_key" ON "Party"("externalKey");
CREATE UNIQUE INDEX "InventoryItem_externalKey_key" ON "InventoryItem"("externalKey");
CREATE INDEX "RoastBatch_greenInventoryItemId_idx" ON "RoastBatch"("greenInventoryItemId");
CREATE INDEX "RoastBatch_roastedInventoryItemId_idx" ON "RoastBatch"("roastedInventoryItemId");
CREATE INDEX "InventoryCostLayer_roastBatchId_idx" ON "InventoryCostLayer"("roastBatchId");
CREATE INDEX "StockMovement_roastBatchId_idx" ON "StockMovement"("roastBatchId");
CREATE INDEX "Shipment_courierPartyId_idx" ON "Shipment"("courierPartyId");

ALTER TABLE "RoastBatch"
  ADD CONSTRAINT "RoastBatch_greenInventoryItemId_fkey"
  FOREIGN KEY ("greenInventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "RoastBatch_roastedInventoryItemId_fkey"
  FOREIGN KEY ("roastedInventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryCostLayer"
  ADD CONSTRAINT "InventoryCostLayer_roastBatchId_fkey"
  FOREIGN KEY ("roastBatchId") REFERENCES "RoastBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_roastBatchId_fkey"
  FOREIGN KEY ("roastBatchId") REFERENCES "RoastBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Shipment"
  ADD CONSTRAINT "Shipment_courierPartyId_fkey"
  FOREIGN KEY ("courierPartyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "FinanceAccount"
SET "externalKey" = 'CASH_ON_HANDS'
WHERE lower(name) = 'cash on hands' AND "externalKey" IS NULL;

INSERT INTO "FinanceAccount" (
  id, "externalKey", name, type, currency, "openingBalance", "isActive", "createdAt"
) VALUES (
  'system-finance-account-fib', 'FIB', 'FIB', 'BANK', 'IQD', 0, true, CURRENT_TIMESTAMP
) ON CONFLICT ("externalKey") DO NOTHING;

UPDATE "Party"
SET "externalKey" = 'HI_EXPRESS'
WHERE (lower(name) LIKE '%hi%express%' OR name LIKE '%هاي%اكسبريس%')
  AND "externalKey" IS NULL;

INSERT INTO "Party" (
  id, "externalKey", name, type, "openingPayable", "openingReceivable", "isActive", "createdAt"
) VALUES (
  'system-party-wayl', 'WAYL', 'Wayl', 'SERVICE_PROVIDER', 0, 0, true, CURRENT_TIMESTAMP
) ON CONFLICT ("externalKey") DO NOTHING;

UPDATE "InventoryItem" SET "externalKey" = 'GREEN_GUJI'
WHERE category = 'GREEN_COFFEE' AND ("nameAr" LIKE '%كوجي%' OR "nameEn" ILIKE '%guji%') AND "externalKey" IS NULL;
UPDATE "InventoryItem" SET "externalKey" = 'GREEN_ROBUSTA'
WHERE category = 'GREEN_COFFEE' AND ("nameAr" LIKE '%روبوستا%' OR "nameEn" ILIKE '%robusta%') AND "externalKey" IS NULL;
UPDATE "InventoryItem" SET "externalKey" = 'GREEN_LEKEMPTI'
WHERE category = 'GREEN_COFFEE' AND ("nameAr" LIKE '%لقمتي%' OR "nameEn" ILIKE '%lekempti%') AND "externalKey" IS NULL;
UPDATE "InventoryItem" SET "externalKey" = 'GREEN_MINAS'
WHERE category = 'GREEN_COFFEE' AND ("nameAr" LIKE '%ميناس%' OR "nameEn" ILIKE '%minas%') AND "externalKey" IS NULL;

INSERT INTO "InventoryItem" (
  id, "externalKey", category, "nameEn", "nameAr", unit, "branchId", "isActive", "createdAt"
)
SELECT 'system-inventory-roasted-guji', 'ROASTED_GUJI_BULK', 'ROASTED', 'Roasted Guji bulk', 'قهوة كوجي محمصة سائبة', 'kg', id, true, CURRENT_TIMESTAMP
FROM "Branch" ORDER BY "createdAt" LIMIT 1
ON CONFLICT ("externalKey") DO NOTHING;

INSERT INTO "InventoryItem" (
  id, "externalKey", category, "nameEn", "nameAr", unit, "branchId", "isActive", "createdAt"
)
SELECT 'system-inventory-roasted-robusta', 'ROASTED_ROBUSTA_BULK', 'ROASTED', 'Roasted Robusta bulk', 'قهوة روبوستا محمصة سائبة', 'kg', id, true, CURRENT_TIMESTAMP
FROM "Branch" ORDER BY "createdAt" LIMIT 1
ON CONFLICT ("externalKey") DO NOTHING;

INSERT INTO "InventoryItem" (
  id, "externalKey", category, "nameEn", "nameAr", unit, "branchId", "isActive", "createdAt"
)
SELECT 'system-inventory-roasted-lekempti', 'ROASTED_LEKEMPTI_BULK', 'ROASTED', 'Roasted Lekempti bulk', 'قهوة لقمتي محمصة سائبة', 'kg', id, true, CURRENT_TIMESTAMP
FROM "Branch" ORDER BY "createdAt" LIMIT 1
ON CONFLICT ("externalKey") DO NOTHING;

INSERT INTO "InventoryItem" (
  id, "externalKey", category, "nameEn", "nameAr", unit, "branchId", "isActive", "createdAt"
)
SELECT 'system-inventory-roasted-minas', 'ROASTED_MINAS_BULK', 'ROASTED', 'Roasted Minas bulk', 'قهوة ميناس محمصة سائبة', 'kg', id, true, CURRENT_TIMESTAMP
FROM "Branch" ORDER BY "createdAt" LIMIT 1
ON CONFLICT ("externalKey") DO NOTHING;
