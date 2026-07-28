BEGIN;

CREATE TYPE "OrderPurpose" AS ENUM ('SALE', 'PROMOTION', 'INTERNAL', 'SAMPLE');
CREATE TYPE "SpendTreatment" AS ENUM ('CAPEX', 'INVENTORY', 'OPEX', 'REVIEW');
CREATE TYPE "ClassificationStatus" AS ENUM ('CONFIRMED', 'NEEDS_REVIEW');
CREATE TYPE "PaymentReconciliationStatus" AS ENUM ('NEEDS_ORDER', 'LINKED', 'IGNORED');

ALTER TABLE "Order"
  ADD COLUMN "purpose" "OrderPurpose" NOT NULL DEFAULT 'SALE';

ALTER TABLE "LedgerEntryLine"
  ADD COLUMN "spendTreatment" "SpendTreatment" NOT NULL DEFAULT 'OPEX',
  ADD COLUMN "classificationStatus" "ClassificationStatus" NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN "classificationSource" TEXT,
  ADD COLUMN "classificationNote" TEXT;

CREATE INDEX "Order_purpose_idx" ON "Order"("purpose");
CREATE INDEX "LedgerEntryLine_spendTreatment_idx" ON "LedgerEntryLine"("spendTreatment");
CREATE INDEX "LedgerEntryLine_classificationStatus_idx" ON "LedgerEntryLine"("classificationStatus");

CREATE TABLE "FixedAssetCostAllocation" (
  "id" TEXT NOT NULL,
  "importKey" TEXT,
  "fixedAssetId" TEXT NOT NULL,
  "financeEntryId" TEXT NOT NULL,
  "ledgerLineId" TEXT,
  "amount" INTEGER NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FixedAssetCostAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FixedAssetCostAllocation_amount_check" CHECK ("amount" > 0)
);

CREATE TABLE "InventoryLandedCostAllocation" (
  "id" TEXT NOT NULL,
  "importKey" TEXT,
  "financeEntryId" TEXT NOT NULL,
  "ledgerLineId" TEXT,
  "inventoryItemId" TEXT,
  "costLayerId" TEXT,
  "amount" INTEGER NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryLandedCostAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryLandedCostAllocation_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "InventoryLandedCostAllocation_target_check" CHECK (
    ("inventoryItemId" IS NULL AND "costLayerId" IS NULL)
    OR ("inventoryItemId" IS NOT NULL AND "costLayerId" IS NOT NULL)
  )
);

CREATE TABLE "PaymentReconciliationItem" (
  "id" TEXT NOT NULL,
  "providerPartyId" TEXT NOT NULL,
  "orderId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "externalCode" TEXT NOT NULL,
  "sourceReference" TEXT,
  "grossAmount" INTEGER NOT NULL,
  "feeAmount" INTEGER NOT NULL DEFAULT 0,
  "netAmount" INTEGER NOT NULL,
  "status" "PaymentReconciliationStatus" NOT NULL DEFAULT 'NEEDS_ORDER',
  "receiptEntryId" TEXT,
  "feeEntryId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentReconciliationItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentReconciliationItem_amounts_check"
    CHECK ("grossAmount" >= 0 AND "feeAmount" >= 0 AND "netAmount" = "grossAmount" - "feeAmount")
);

CREATE UNIQUE INDEX "FixedAssetCostAllocation_importKey_key"
  ON "FixedAssetCostAllocation"("importKey");
CREATE INDEX "FixedAssetCostAllocation_fixedAssetId_idx"
  ON "FixedAssetCostAllocation"("fixedAssetId");
CREATE INDEX "FixedAssetCostAllocation_financeEntryId_idx"
  ON "FixedAssetCostAllocation"("financeEntryId");
CREATE INDEX "FixedAssetCostAllocation_ledgerLineId_idx"
  ON "FixedAssetCostAllocation"("ledgerLineId");

CREATE UNIQUE INDEX "InventoryLandedCostAllocation_importKey_key"
  ON "InventoryLandedCostAllocation"("importKey");
CREATE INDEX "InventoryLandedCostAllocation_financeEntryId_idx"
  ON "InventoryLandedCostAllocation"("financeEntryId");
CREATE INDEX "InventoryLandedCostAllocation_ledgerLineId_idx"
  ON "InventoryLandedCostAllocation"("ledgerLineId");
CREATE INDEX "InventoryLandedCostAllocation_inventoryItemId_idx"
  ON "InventoryLandedCostAllocation"("inventoryItemId");
CREATE INDEX "InventoryLandedCostAllocation_costLayerId_idx"
  ON "InventoryLandedCostAllocation"("costLayerId");

CREATE UNIQUE INDEX "PaymentReconciliationItem_receiptEntryId_key"
  ON "PaymentReconciliationItem"("receiptEntryId");
CREATE UNIQUE INDEX "PaymentReconciliationItem_feeEntryId_key"
  ON "PaymentReconciliationItem"("feeEntryId");
CREATE UNIQUE INDEX "PaymentReconciliationItem_providerPartyId_externalCode_key"
  ON "PaymentReconciliationItem"("providerPartyId", "externalCode");
CREATE INDEX "PaymentReconciliationItem_status_occurredAt_idx"
  ON "PaymentReconciliationItem"("status", "occurredAt");
CREATE INDEX "PaymentReconciliationItem_orderId_idx"
  ON "PaymentReconciliationItem"("orderId");

ALTER TABLE "FixedAssetCostAllocation"
  ADD CONSTRAINT "FixedAssetCostAllocation_fixedAssetId_fkey"
  FOREIGN KEY ("fixedAssetId") REFERENCES "FixedAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "FixedAssetCostAllocation_financeEntryId_fkey"
  FOREIGN KEY ("financeEntryId") REFERENCES "FinanceEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "FixedAssetCostAllocation_ledgerLineId_fkey"
  FOREIGN KEY ("ledgerLineId") REFERENCES "LedgerEntryLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryLandedCostAllocation"
  ADD CONSTRAINT "InventoryLandedCostAllocation_financeEntryId_fkey"
  FOREIGN KEY ("financeEntryId") REFERENCES "FinanceEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryLandedCostAllocation_ledgerLineId_fkey"
  FOREIGN KEY ("ledgerLineId") REFERENCES "LedgerEntryLine"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryLandedCostAllocation_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryLandedCostAllocation_costLayerId_fkey"
  FOREIGN KEY ("costLayerId") REFERENCES "InventoryCostLayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentReconciliationItem"
  ADD CONSTRAINT "PaymentReconciliationItem_providerPartyId_fkey"
  FOREIGN KEY ("providerPartyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentReconciliationItem_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentReconciliationItem_receiptEntryId_fkey"
  FOREIGN KEY ("receiptEntryId") REFERENCES "FinanceEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentReconciliationItem_feeEntryId_fkey"
  FOREIGN KEY ("feeEntryId") REFERENCES "FinanceEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every spending entry gets line-level accounting treatment. Older single-line
-- entries are converted to an explicit line so all reports use the same facts.
INSERT INTO "LedgerEntryLine" (
  "id", "financeEntryId", "lineNo", "itemType", "itemName", "categoryType",
  "unit", "quantity", "unitCost", "landedUnitCost", "lineTotal", "branchId",
  "notes", "spendTreatment", "classificationStatus", "classificationSource"
)
SELECT
  concat('canonical-line-', entry.id),
  entry.id,
  1,
  CASE
    WHEN EXISTS (SELECT 1 FROM "FixedAsset" asset WHERE asset."financeEntryId" = entry.id AND asset."isActive") THEN 'ASSET'
    WHEN EXISTS (SELECT 1 FROM "InventoryCostLayer" layer WHERE layer."financeEntryId" = entry.id) THEN 'INVENTORY'
    ELSE 'EXPENSE'
  END,
  coalesce(entry.description, entry.reference, 'Recorded spending'),
  entry."categoryType",
  'unit',
  1,
  entry.amount,
  entry.amount,
  entry.amount,
  entry."branchId",
  'Canonical line created from historical single-line record.',
  CASE
    WHEN EXISTS (SELECT 1 FROM "FixedAsset" asset WHERE asset."financeEntryId" = entry.id AND asset."isActive") THEN 'CAPEX'::"SpendTreatment"
    WHEN EXISTS (SELECT 1 FROM "InventoryCostLayer" layer WHERE layer."financeEntryId" = entry.id) THEN 'INVENTORY'::"SpendTreatment"
    ELSE 'OPEX'::"SpendTreatment"
  END,
  'CONFIRMED',
  'historical-backfill'
FROM "FinanceEntry" entry
WHERE
  entry.type IN ('EXPENSE', 'PURCHASE')
  AND entry."archivedAt" IS NULL
  AND entry."reversedAt" IS NULL
  AND entry."reversalOfId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "LedgerEntryLine" line WHERE line."financeEntryId" = entry.id
  );

UPDATE "LedgerEntryLine"
SET
  "spendTreatment" = CASE
    WHEN upper("itemType") = 'ASSET' THEN 'CAPEX'::"SpendTreatment"
    WHEN upper("itemType") = 'INVENTORY' THEN 'INVENTORY'::"SpendTreatment"
    WHEN upper("itemType") IN ('EXPENSE', 'SERVICE') THEN 'OPEX'::"SpendTreatment"
    ELSE 'REVIEW'::"SpendTreatment"
  END,
  "classificationStatus" = CASE
    WHEN upper("itemType") IN ('ASSET', 'INVENTORY', 'EXPENSE', 'SERVICE')
      THEN 'CONFIRMED'::"ClassificationStatus"
    ELSE 'NEEDS_REVIEW'::"ClassificationStatus"
  END,
  "classificationSource" = coalesce("classificationSource", 'historical-item-type');

INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", metadata)
SELECT
  concat('audit-finance-classification-', line.id),
  owner_user.id,
  'FINANCE_CLASSIFICATION_CORRECTION',
  'LedgerEntryLine',
  line.id,
  jsonb_build_object(
    'recordKey', entry."recordKey",
    'before', jsonb_build_object(
      'itemType', line."itemType",
      'spendTreatment', line."spendTreatment",
      'classificationStatus', line."classificationStatus",
      'categoryType', line."categoryType",
      'amount', line."lineTotal"
    ),
    'after', jsonb_build_object(
      'spendTreatment', CASE
        WHEN entry."recordKey" IN ('DOC000144', 'DOC000155', 'DOC000169', 'DOC000117')
          THEN 'CAPEX'
        WHEN entry."recordKey" IN ('DOC000105', 'DOC000109', 'DOC000125', 'DOC000154', 'DOC000163')
          THEN 'INVENTORY'
        ELSE 'REVIEW'
      END,
      'classificationStatus', CASE
        WHEN entry."recordKey" IN ('DOC000128', 'DOC000159', 'DOC000228')
          THEN 'NEEDS_REVIEW'
        ELSE 'CONFIRMED'
      END
    ),
    'reason', 'Audited 2026-07-28 finance integrity correction'
  )
FROM "LedgerEntryLine" line
JOIN "FinanceEntry" entry ON entry.id = line."financeEntryId"
LEFT JOIN LATERAL (
  SELECT id FROM "User" WHERE role IN ('OWNER', 'ADMIN') ORDER BY "createdAt" LIMIT 1
) owner_user ON true
WHERE entry."recordKey" IN (
  'DOC000105', 'DOC000109', 'DOC000117', 'DOC000125', 'DOC000128',
  'DOC000144', 'DOC000154', 'DOC000155', 'DOC000159', 'DOC000163',
  'DOC000169', 'DOC000228'
)
ON CONFLICT (id) DO NOTHING;

-- Owner-confirmed branding: all Solo Studio payments are one IQD 6,000,000
-- intangible asset with three transparent source allocations.
UPDATE "FinanceEntry"
SET
  type = 'PURCHASE',
  "recordClass" = 'PURCHASE',
  "categoryType" = 'EQUIPMENT'
WHERE "recordKey" IN ('DOC000144', 'DOC000155', 'DOC000169');

UPDATE "LedgerEntryLine"
SET
  "itemType" = 'ASSET',
  "assetKey" = 'LAHEEB_BRAND_IDENTITY',
  "assetCategory" = 'Branding intangible asset',
  "categoryType" = 'EQUIPMENT',
  "spendTreatment" = 'CAPEX',
  "classificationStatus" = 'CONFIRMED',
  "classificationSource" = 'owner-confirmed-2026-07-28',
  "classificationNote" = 'Solo Studio branding payment allocated to the Laheeb brand identity asset.'
WHERE "financeEntryId" IN (
  SELECT id FROM "FinanceEntry" WHERE "recordKey" IN ('DOC000144', 'DOC000155', 'DOC000169')
);

UPDATE "FixedAsset"
SET
  "isActive" = false,
  "archivedAt" = coalesce("archivedAt", CURRENT_TIMESTAMP),
  "archiveReason" = 'Consolidated into ASSET:BRAND_IDENTITY:LAHEEB',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "financeEntryId" IN (
  SELECT id FROM "FinanceEntry" WHERE "recordKey" IN ('DOC000144', 'DOC000155', 'DOC000169')
);

INSERT INTO "FixedAsset" (
  "id", "importKey", name, category, quantity, unit, "totalCost", "unitCost",
  "purchaseDate", notes, "isActive", "createdAt", "updatedAt"
)
SELECT
  'asset-laheeb-brand-identity',
  'ASSET:BRAND_IDENTITY:LAHEEB',
  'Laheeb brand identity',
  'Branding intangible asset',
  1,
  'asset',
  6000000,
  6000000,
  min(date),
  'Owner-confirmed consolidation of DOC000144, DOC000155 and DOC000169. No amortization is posted until a useful life is configured.',
  true,
  min("createdAt"),
  CURRENT_TIMESTAMP
FROM "FinanceEntry"
WHERE "recordKey" IN ('DOC000144', 'DOC000155', 'DOC000169')
HAVING count(*) > 0
ON CONFLICT ("importKey") DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  "totalCost" = EXCLUDED."totalCost",
  "unitCost" = EXCLUDED."unitCost",
  notes = EXCLUDED.notes,
  "isActive" = true,
  "archivedAt" = NULL,
  "archiveReason" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "FixedAssetCostAllocation" (
  id, "importKey", "fixedAssetId", "financeEntryId", "ledgerLineId", amount, notes
)
SELECT
  concat('asset-allocation-brand-', entry."recordKey"),
  concat('ASSET:BRAND_IDENTITY:LAHEEB:', entry."recordKey"),
  asset.id,
  entry.id,
  line.id,
  entry.amount,
  concat('Source payment ', entry."recordKey")
FROM "FinanceEntry" entry
JOIN "FixedAsset" asset ON asset."importKey" = 'ASSET:BRAND_IDENTITY:LAHEEB'
LEFT JOIN LATERAL (
  SELECT id FROM "LedgerEntryLine"
  WHERE "financeEntryId" = entry.id
  ORDER BY "lineNo"
  LIMIT 1
) line ON true
WHERE entry."recordKey" IN ('DOC000144', 'DOC000155', 'DOC000169')
ON CONFLICT ("importKey") DO UPDATE
SET amount = EXCLUDED.amount, notes = EXCLUDED.notes;

-- Owner-confirmed IQD 100,000 espresso preparation tool set.
UPDATE "FinanceEntry"
SET type = 'PURCHASE', "recordClass" = 'PURCHASE', "categoryType" = 'EQUIPMENT'
WHERE "recordKey" = 'DOC000117';

UPDATE "LedgerEntryLine"
SET
  "itemType" = 'ASSET',
  "assetKey" = 'ESPRESSO_PREPARATION_TOOL_SET',
  "assetCategory" = 'Small equipment',
  "categoryType" = 'EQUIPMENT',
  "spendTreatment" = 'CAPEX',
  "classificationStatus" = 'CONFIRMED',
  "classificationSource" = 'owner-confirmed-2026-07-28',
  "classificationNote" = 'Reusable espresso preparation tools.'
WHERE "financeEntryId" IN (
  SELECT id FROM "FinanceEntry" WHERE "recordKey" = 'DOC000117'
);

INSERT INTO "FixedAsset" (
  id, "importKey", name, category, quantity, unit, "totalCost", "unitCost",
  "purchaseDate", "partyId", "branchId", notes, "isActive", "createdById",
  "createdAt", "updatedAt"
)
SELECT
  'asset-espresso-preparation-tools',
  'ASSET:ESPRESSO_PREPARATION_TOOLS:DOC000117',
  'Espresso preparation tool set',
  'Small equipment',
  1,
  'set',
  entry.amount,
  entry.amount,
  entry.date,
  entry."partyId",
  entry."branchId",
  'Owner-confirmed reusable tool set.',
  true,
  entry."createdById",
  entry."createdAt",
  CURRENT_TIMESTAMP
FROM "FinanceEntry" entry
WHERE entry."recordKey" = 'DOC000117'
ON CONFLICT ("importKey") DO UPDATE
SET
  "totalCost" = EXCLUDED."totalCost",
  "unitCost" = EXCLUDED."unitCost",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "FixedAssetCostAllocation" (
  id, "importKey", "fixedAssetId", "financeEntryId", "ledgerLineId", amount, notes
)
SELECT
  concat('asset-allocation-tools-', line.id),
  concat('ASSET:ESPRESSO_PREPARATION_TOOLS:', line.id),
  asset.id,
  entry.id,
  line.id,
  line."lineTotal",
  'Source line from DOC000117'
FROM "FinanceEntry" entry
JOIN "LedgerEntryLine" line ON line."financeEntryId" = entry.id
JOIN "FixedAsset" asset ON asset."importKey" = 'ASSET:ESPRESSO_PREPARATION_TOOLS:DOC000117'
WHERE entry."recordKey" = 'DOC000117'
ON CONFLICT ("importKey") DO UPDATE SET amount = EXCLUDED.amount;

-- Backfill transparent source allocations for all other active historical
-- assets without changing their recorded value.
INSERT INTO "FixedAssetCostAllocation" (
  id, "importKey", "fixedAssetId", "financeEntryId", "ledgerLineId", amount, notes
)
SELECT
  concat('asset-allocation-history-', line.id),
  concat('ASSET:HISTORICAL_LINE:', line.id),
  asset.id,
  line."financeEntryId",
  line.id,
  line."lineTotal",
  'Historical asset source allocation backfill.'
FROM "LedgerEntryLine" line
JOIN LATERAL (
  SELECT id
  FROM "FixedAsset"
  WHERE "isActive" = true
    AND (
      ("importKey" = concat('ASSET:HISTORICAL_SPEND:', line."assetKey") AND line."assetKey" IS NOT NULL)
      OR "financeEntryId" = line."financeEntryId"
    )
  ORDER BY
    CASE
      WHEN "importKey" = concat('ASSET:HISTORICAL_SPEND:', line."assetKey") THEN 0
      WHEN "financeEntryId" = line."financeEntryId"
        AND name = line."itemName"
        AND "totalCost" = line."lineTotal" THEN 1
      ELSE 2
    END,
    "createdAt",
    id
  LIMIT 1
) asset ON true
WHERE
  line."spendTreatment" = 'CAPEX'
  AND NOT EXISTS (
    SELECT 1 FROM "FixedAssetCostAllocation" allocation
    WHERE allocation."ledgerLineId" = line.id
  )
ON CONFLICT ("importKey") DO UPDATE SET amount = EXCLUDED.amount;

-- Freight is inventory acquisition cost awaiting a deliberate landed-cost
-- allocation. It is not operating expense.
UPDATE "LedgerEntryLine"
SET
  "itemType" = 'INVENTORY',
  "spendTreatment" = 'INVENTORY',
  "classificationStatus" = 'CONFIRMED',
  "classificationSource" = 'owner-confirmed-2026-07-28',
  "classificationNote" = 'Inventory freight awaiting landed-cost allocation.'
WHERE "financeEntryId" IN (
  SELECT id FROM "FinanceEntry"
  WHERE "recordKey" IN ('DOC000105', 'DOC000109', 'DOC000125', 'DOC000154')
);

INSERT INTO "InventoryLandedCostAllocation" (
  id, "importKey", "financeEntryId", "ledgerLineId", amount, notes
)
SELECT
  concat('landed-cost-pending-', line.id),
  concat('LANDED:PENDING:', line.id),
  entry.id,
  line.id,
  line."lineTotal",
  'Pending Owner/Admin allocation to an inventory item or cost layer.'
FROM "FinanceEntry" entry
JOIN "LedgerEntryLine" line ON line."financeEntryId" = entry.id
WHERE entry."recordKey" IN ('DOC000105', 'DOC000109', 'DOC000125', 'DOC000154')
ON CONFLICT ("importKey") DO UPDATE SET amount = EXCLUDED.amount;

-- Mixed or uncertain records remain conservatively in Opex but are made
-- visible for review instead of being silently guessed.
UPDATE "LedgerEntryLine"
SET
  "spendTreatment" = 'REVIEW',
  "classificationStatus" = 'NEEDS_REVIEW',
  "classificationSource" = 'integrity-review-2026-07-28',
  "classificationNote" = CASE
    WHEN "financeEntryId" IN (
      SELECT id FROM "FinanceEntry" WHERE "recordKey" IN ('DOC000128', 'DOC000159')
    ) THEN 'Mixed rent, deposit and broker cost: split by Owner/Admin when supporting detail is available.'
    ELSE 'Shipping classification requires Owner/Admin confirmation.'
  END
WHERE "financeEntryId" IN (
  SELECT id FROM "FinanceEntry" WHERE "recordKey" IN ('DOC000128', 'DOC000159', 'DOC000228')
);

UPDATE "LedgerEntryLine"
SET
  "itemType" = 'INVENTORY',
  "spendTreatment" = 'INVENTORY',
  "classificationStatus" = 'CONFIRMED',
  "classificationSource" = 'validated-source-record',
  "classificationNote" = '1,000 paper-cup holders at IQD 840 each.'
WHERE "financeEntryId" IN (
  SELECT id FROM "FinanceEntry" WHERE "recordKey" = 'DOC000163'
);

-- Pickup orders cannot incur courier expense. Preserve a before/after audit
-- snapshot and clear the eight incorrect IQD 5,000 values.
INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", metadata)
SELECT
  concat('audit-clear-pickup-fee-', orders.id),
  owner_user.id,
  'CLEAR_INVALID_PICKUP_DELIVERY_COST',
  'Order',
  orders.id,
  jsonb_build_object(
    'orderNumber', orders."orderNumber",
    'beforeDeliveryCost', orders."deliveryCost",
    'afterDeliveryCost', 0,
    'reason', 'Pickup orders do not use a courier'
  )
FROM "Order" orders
LEFT JOIN LATERAL (
  SELECT id FROM "User" WHERE role IN ('OWNER', 'ADMIN') ORDER BY "createdAt" LIMIT 1
) owner_user ON true
WHERE orders."fulfillmentMethod" = 'PICKUP' AND orders."deliveryCost" > 0
ON CONFLICT (id) DO NOTHING;

UPDATE "Order"
SET "deliveryCost" = 0
WHERE "fulfillmentMethod" = 'PICKUP' AND "deliveryCost" > 0;

-- Missing courier fees are posted to a neutral review party. No courier or
-- shipment is fabricated.
INSERT INTO "Party" (
  id, "externalKey", name, type, notes, "isActive", "createdAt"
)
VALUES (
  'party-unassigned-courier',
  'UNASSIGNED_COURIER',
  'Unassigned courier',
  'SERVICE_PROVIDER',
  'Courier expense recorded from completed courier orders whose shipment/provider was not captured.',
  true,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("externalKey") DO UPDATE
SET name = EXCLUDED.name, notes = EXCLUDED.notes, "isActive" = true;

INSERT INTO "FinanceEntry" (
  id, date, type, "recordClass", amount, currency, obligation, "obligationKind",
  "partyId", "categoryType", "costRole", "importKey", description, reference,
  "branchId", "orderId", "createdAt"
)
SELECT
  concat('finance-missing-courier-', orders.id),
  orders."placedAt",
  'EXPENSE',
  'EXPENSE',
  orders."deliveryCost",
  'IQD',
  true,
  'PAYABLE',
  courier.id,
  'SHIPPING',
  'DIRECT_DELIVERY',
  concat('ORDER:', orders.id, ':UNASSIGNED_COURIER:FEE'),
  'Courier fee awaiting provider assignment',
  orders."orderNumber",
  orders."branchId",
  orders.id,
  CURRENT_TIMESTAMP
FROM "Order" orders
JOIN "Party" courier ON courier."externalKey" = 'UNASSIGNED_COURIER'
WHERE
  orders."fulfillmentMethod" = 'COURIER'
  AND orders."deliveryCost" > 0
  AND NOT EXISTS (
    SELECT 1
    FROM "FinanceEntry" fee
    WHERE
      fee."orderId" = orders.id
      AND fee."costRole" = 'DIRECT_DELIVERY'
      AND fee."archivedAt" IS NULL
      AND fee."reversedAt" IS NULL
      AND fee."reversalOfId" IS NULL
  )
ON CONFLICT ("importKey") DO NOTHING;

INSERT INTO "LedgerEntryLine" (
  id, "financeEntryId", "lineNo", "itemType", "itemName", "categoryType",
  unit, quantity, "unitCost", "landedUnitCost", "lineTotal", "branchId",
  notes, "spendTreatment", "classificationStatus", "classificationSource",
  "classificationNote"
)
SELECT
  concat('line-missing-courier-', entry."orderId"),
  entry.id,
  1,
  'SERVICE',
  'Courier delivery',
  'SHIPPING',
  'service',
  1,
  entry.amount,
  entry.amount,
  entry.amount,
  entry."branchId",
  'Posted from order delivery cost.',
  'OPEX',
  'CONFIRMED',
  'courier-gap-reconciliation',
  'Assign the correct courier/provider when known.'
FROM "FinanceEntry" entry
WHERE entry."importKey" LIKE 'ORDER:%:UNASSIGNED_COURIER:FEE'
ON CONFLICT ("financeEntryId", "lineNo") DO NOTHING;

-- The approved source correction reverses the unsupported IQD 13,500 payment.
-- Restore stock and leave that order pending/unpaid.
INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", metadata)
SELECT
  concat('audit-reverse-unreceived-order-', orders.id),
  owner_user.id,
  'REVERSE_UNRECEIVED_ORDER',
  'Order',
  orders.id,
  jsonb_build_object(
    'before', jsonb_build_object(
      'orderNumber', orders."orderNumber",
      'status', orders.status,
      'purpose', orders.purpose,
      'inventorySyncMode', orders."inventorySyncMode",
      'activePaymentAndDirectCost', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', entry.id,
          'type', entry.type,
          'amount', entry.amount,
          'costRole', entry."costRole"
        ))
        FROM "FinanceEntry" entry
        WHERE entry."orderId" = orders.id
          AND ((entry.type IN ('INCOME', 'PAYMENT_IN') AND entry.obligation = false)
            OR entry."costRole" IN ('DIRECT_DELIVERY', 'PAYMENT_PROCESSING'))
          AND entry."archivedAt" IS NULL
          AND entry."reversedAt" IS NULL
          AND entry."reversalOfId" IS NULL
      ), '[]'::jsonb)
    ),
    'after', jsonb_build_object(
      'status', 'PENDING',
      'purpose', 'SALE',
      'inventorySyncMode', 'NORMAL',
      'paymentState', 'UNPAID'
    ),
    'reason', 'Source note explicitly states no customer payment was received.'
  )
FROM "Order" orders
LEFT JOIN LATERAL (
  SELECT id FROM "User" WHERE role IN ('OWNER', 'ADMIN') ORDER BY "createdAt" LIMIT 1
) owner_user ON true
WHERE orders.id = 'cmraejsoi0001l104jxbxbuua'
ON CONFLICT (id) DO NOTHING;

UPDATE "FinanceEntry"
SET
  "reversedAt" = coalesce("reversedAt", CURRENT_TIMESTAMP),
  "reversalReason" = coalesce("reversalReason", 'Source note states no customer payment was received.')
WHERE "orderId" = 'cmraejsoi0001l104jxbxbuua'
  AND (
    (type IN ('INCOME', 'PAYMENT_IN') AND obligation = false)
    OR "costRole" IN ('DIRECT_DELIVERY', 'PAYMENT_PROCESSING')
  )
  AND "reversalOfId" IS NULL;

DELETE FROM "StockMovement"
WHERE "orderId" = 'cmraejsoi0001l104jxbxbuua';

UPDATE "Order"
SET status = 'PENDING', purpose = 'SALE', "inventorySyncMode" = 'NORMAL'
WHERE id = 'cmraejsoi0001l104jxbxbuua';

-- Fully discounted completed orders are promotions, not earned sales.
INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", metadata)
SELECT
  concat('audit-promotion-order-', orders.id),
  owner_user.id,
  'CLASSIFY_PROMOTION_ORDER',
  'Order',
  orders.id,
  jsonb_build_object(
    'before', jsonb_build_object('purpose', orders.purpose, 'status', orders.status),
    'after', jsonb_build_object('purpose', 'PROMOTION', 'status', orders.status),
    'consumedCost', COALESCE((
      SELECT SUM(line.quantity * line."unitCogsSnapshot")
      FROM "OrderLine" line
      WHERE line."orderId" = orders.id
    ), 0),
    'reason', 'Fully discounted completed order is promotion activity, not earned sales.'
  )
FROM "Order" orders
LEFT JOIN LATERAL (
  SELECT id FROM "User" WHERE role IN ('OWNER', 'ADMIN') ORDER BY "createdAt" LIMIT 1
) owner_user ON true
WHERE
  orders.status = 'COMPLETED'
  AND greatest(
    orders."grossAmount" - orders."discountAmount" - orders."refundAmount"
      + orders."deliveryFee" + orders."extraCharges",
    0
  ) = 0
ON CONFLICT (id) DO NOTHING;

UPDATE "Order"
SET purpose = 'PROMOTION'
WHERE
  status = 'COMPLETED'
  AND greatest(
    "grossAmount" - "discountAmount" - "refundAmount" + "deliveryFee" + "extraCharges",
    0
  ) = 0;

-- Imported shipment charges are direct selling costs. Keep them inside total
-- Opex, but separate them from overhead on the P&L.
UPDATE "FinanceEntry"
SET "costRole" = 'DIRECT_DELIVERY'
WHERE "importKey" LIKE 'SHIP:%:COST'
  AND type = 'EXPENSE'
  AND "archivedAt" IS NULL
  AND "reversedAt" IS NULL
  AND "reversalOfId" IS NULL;

-- Parent labels follow the canonical line allocation rather than historical
-- source wording. REVIEW is conservatively included in operating spending.
UPDATE "FinanceEntry" entry
SET
  type = CASE
    WHEN EXISTS (
      SELECT 1 FROM "LedgerEntryLine" line
      WHERE line."financeEntryId" = entry.id
        AND line."spendTreatment" IN ('CAPEX', 'INVENTORY')
    ) THEN 'PURCHASE'::"FinanceType"
    ELSE 'EXPENSE'::"FinanceType"
  END,
  "recordClass" = CASE
    WHEN EXISTS (
      SELECT 1 FROM "LedgerEntryLine" line
      WHERE line."financeEntryId" = entry.id
        AND line."spendTreatment" IN ('CAPEX', 'INVENTORY')
    ) AND EXISTS (
      SELECT 1 FROM "LedgerEntryLine" line
      WHERE line."financeEntryId" = entry.id
        AND line."spendTreatment" IN ('OPEX', 'REVIEW')
    ) THEN 'MIXED'::"LedgerRecordClass"
    WHEN EXISTS (
      SELECT 1 FROM "LedgerEntryLine" line
      WHERE line."financeEntryId" = entry.id
        AND line."spendTreatment" IN ('CAPEX', 'INVENTORY')
    ) THEN 'PURCHASE'::"LedgerRecordClass"
    ELSE 'EXPENSE'::"LedgerRecordClass"
  END
WHERE entry.type IN ('EXPENSE', 'PURCHASE')
  AND entry."archivedAt" IS NULL
  AND entry."reversedAt" IS NULL
  AND entry."reversalOfId" IS NULL
  AND EXISTS (
    SELECT 1 FROM "LedgerEntryLine" line WHERE line."financeEntryId" = entry.id
  );

-- Re-derive the active FIFO cost after the audited order reversals, then
-- refresh every linked product recipe. This keeps future COGS snapshots aligned
-- without rewriting historical order-line COGS.
WITH active_layers AS (
  SELECT
    layer.id,
    layer."inventoryItemId",
    layer."qtyReceived",
    layer."unitCost",
    layer."receivedAt",
    SUM(layer."qtyReceived") OVER (
      PARTITION BY layer."inventoryItemId"
      ORDER BY layer."receivedAt", layer.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cumulative_received,
    MIN(layer."receivedAt") OVER (
      PARTITION BY layer."inventoryItemId"
    ) AS first_received
  FROM "InventoryCostLayer" layer
  LEFT JOIN "FinanceEntry" source ON source.id = layer."financeEntryId"
  WHERE layer."financeEntryId" IS NULL
    OR (
      source."archivedAt" IS NULL
      AND source."reversedAt" IS NULL
      AND source."reversalOfId" IS NULL
    )
),
consumed AS (
  SELECT
    layer."inventoryItemId",
    COALESCE(-SUM(movement.quantity) FILTER (
      WHERE movement.quantity < 0
        AND movement."occurredAt" >= layer.first_received
        AND (
          movement."financeEntryId" IS NULL
          OR (
            movement_source."archivedAt" IS NULL
            AND movement_source."reversedAt" IS NULL
            AND movement_source."reversalOfId" IS NULL
          )
        )
    ), 0) AS quantity_consumed
  FROM (
    SELECT "inventoryItemId", MIN(first_received) AS first_received
    FROM active_layers
    GROUP BY "inventoryItemId"
  ) layer
  LEFT JOIN "StockMovement" movement
    ON movement."inventoryItemId" = layer."inventoryItemId"
  LEFT JOIN "FinanceEntry" movement_source
    ON movement_source.id = movement."financeEntryId"
  GROUP BY layer."inventoryItemId"
),
active_cost AS (
  SELECT DISTINCT ON (layer."inventoryItemId")
    layer."inventoryItemId",
    layer."unitCost"
  FROM active_layers layer
  JOIN consumed
    ON consumed."inventoryItemId" = layer."inventoryItemId"
  WHERE layer.cumulative_received > consumed.quantity_consumed
  ORDER BY layer."inventoryItemId", layer."receivedAt", layer.id
)
UPDATE "InventoryItem" item
SET "unitCost" = active_cost."unitCost"
FROM active_cost
WHERE item.id = active_cost."inventoryItemId";

UPDATE "ProductComponent" component
SET "unitCost" = item."unitCost"
FROM "InventoryItem" item
WHERE component."inventoryItemId" = item.id
  AND item."unitCost" IS NOT NULL;

UPDATE "Product" product
SET "cogsPerUnit" = ROUND(cost.total)::integer
FROM (
  SELECT component."productId", SUM(component.quantity * component."unitCost") AS total
  FROM "ProductComponent" component
  GROUP BY component."productId"
) cost
WHERE product.id = cost."productId";

-- Recalculate customer caches from completed, real-sale orders only.
UPDATE "Customer" customer
SET
  "ordersCount" = stats.order_count,
  "firstOrderAt" = stats.first_order,
  "lastOrderAt" = stats.last_order
FROM (
  SELECT
    customer.id,
    count(orders.id)::integer AS order_count,
    min(orders."placedAt") AS first_order,
    max(orders."placedAt") AS last_order
  FROM "Customer" customer
  LEFT JOIN "Order" orders
    ON orders."customerId" = customer.id
    AND orders.status = 'COMPLETED'
    AND orders.purpose = 'SALE'
  GROUP BY customer.id
) stats
WHERE customer.id = stats.id;

-- Wayl is represented by a hidden clearing wallet. Statement sales enter the
-- wallet, exact statement fees leave it, and payouts transfer to FIB.
INSERT INTO "FinanceAccount" (
  id, "externalKey", name, type, currency, "openingBalance", notes, "isActive", "createdAt"
)
VALUES (
  'account-wayl-clearing-wallet',
  'WAYL_WALLET',
  'Wayl clearing wallet',
  'PAYMENT_GATEWAY',
  'IQD',
  0,
  'Hidden clearing account. Balance must equal the latest Wayl statement wallet balance.',
  true,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("externalKey") DO UPDATE
SET name = EXCLUDED.name, type = EXCLUDED.type, notes = EXCLUDED.notes, "isActive" = true;

UPDATE "Party"
SET
  "automaticOrderSettlement" = false,
  "collectsOrderPayments" = true,
  "netFeesFromRemittance" = true,
  "providerFeeMode" = 'PERCENT_PLUS_FIXED',
  "feeRateBps" = 350,
  "fixedFee" = 600,
  "defaultSettlementAccountId" = (
    SELECT id FROM "FinanceAccount" WHERE "externalKey" = 'WAYL_WALLET'
  )
WHERE "externalKey" = 'WAYL';

UPDATE "Party"
SET
  "automaticOrderSettlement" = false,
  "collectsOrderPayments" = true,
  "netFeesFromRemittance" = true
WHERE "externalKey" = 'HI_EXPRESS';

CREATE TEMP TABLE "_wayl_statement" (
  code TEXT PRIMARY KEY,
  occurred_at TIMESTAMP(3) NOT NULL,
  gross INTEGER NOT NULL,
  fee INTEGER NOT NULL
) ON COMMIT DROP;

INSERT INTO "_wayl_statement" (code, occurred_at, gross, fee) VALUES
  ('1A52C792', '2026-05-18T00:00:00+03:00', 27500, 1562),
  ('998C8C52', '2026-05-24T00:00:00+03:00', 29000, 1615),
  ('E3FCD7DA', '2026-05-27T00:00:00+03:00', 22000, 1370),
  ('EB5369GD', '2026-06-03T00:00:00+03:00', 22000, 1370),
  ('I9D0FC09', '2026-06-09T00:00:00+03:00', 17500, 1212),
  ('I56H8BB5', '2026-06-19T00:00:00+03:00', 17500, 1212),
  ('G8G9AHEI', '2026-06-25T00:00:00+03:00', 17500, 1212),
  ('IHID421E', '2026-06-28T00:00:00+03:00', 22000, 1370),
  ('656I8DD3', '2026-07-02T00:00:00+03:00', 25000, 1475),
  ('8D717699', '2026-07-06T00:00:00+03:00', 25000, 1475),
  ('8GIFG6B7', '2026-07-12T00:00:00+03:00', 25000, 1475),
  ('874B6HCI', '2026-07-18T00:00:00+03:00', 25000, 1474);

CREATE TEMP TABLE "_wayl_match" ON COMMIT DROP AS
SELECT
  statement.*,
  matched_order.id AS order_id,
  matched_order."branchId" AS branch_id
FROM "_wayl_statement" statement
LEFT JOIN LATERAL (
  SELECT orders.id, orders."branchId"
  FROM "Order" orders
  WHERE
    orders."orderNumber" ILIKE concat('%', statement.code, '%')
    OR coalesce(orders.notes, '') ILIKE concat('%', statement.code, '%')
  ORDER BY orders."createdAt"
  LIMIT 1
) matched_order ON true;

-- The historical export attached the correct Wayl codes to orders, but five
-- individual source amounts differ from their invoice totals. The seven
-- matched statement rows and seven matched invoices reconcile exactly as one
-- pool. Refuse to continue if that audited identity no longer holds.
DO $$
DECLARE
  matched_statement_total BIGINT;
  matched_invoice_total BIGINT;
BEGIN
  SELECT COALESCE(SUM(match.gross), 0)
  INTO matched_statement_total
  FROM "_wayl_match" match
  WHERE match.order_id IS NOT NULL;

  SELECT COALESCE(SUM(GREATEST(
    orders."grossAmount" - orders."discountAmount" - orders."refundAmount"
      + orders."deliveryFee" + orders."extraCharges",
    0
  )), 0)
  INTO matched_invoice_total
  FROM "_wayl_match" match
  JOIN "Order" orders ON orders.id = match.order_id;

  IF matched_statement_total <> matched_invoice_total THEN
    RAISE EXCEPTION
      'Wayl matched statement pool (%) does not equal matched invoice pool (%)',
      matched_statement_total,
      matched_invoice_total;
  END IF;
END $$;

-- Archive prior account postings for statement-matched orders so statement
-- receipts are the single cash source.
UPDATE "FinanceEntry" entry
SET
  "archivedAt" = coalesce(entry."archivedAt", CURRENT_TIMESTAMP),
  "archiveReason" = coalesce(entry."archiveReason", 'Replaced by exact Wayl statement reconciliation.')
WHERE entry."orderId" IN (
  SELECT order_id FROM "_wayl_match" WHERE order_id IS NOT NULL
)
AND (
  (entry.type IN ('PAYMENT_IN', 'INCOME') AND entry.obligation = false)
  OR entry."costRole" = 'PAYMENT_PROCESSING'
);

INSERT INTO "FinanceEntry" (
  id, date, type, "recordClass", amount, currency, obligation, "accountId",
  "partyId", "costRole", "paymentMethod", "settlesId", "importKey",
  description, reference, "branchId", "orderId", "createdAt"
)
SELECT
  concat('wayl-statement-receipt-', match.code),
  match.occurred_at,
  'PAYMENT_IN',
  NULL,
  CASE
    WHEN match.order_id IS NULL THEN match.gross
    ELSE GREATEST(
      orders."grossAmount" - orders."discountAmount" - orders."refundAmount"
        + orders."deliveryFee" + orders."extraCharges",
      0
    )
  END,
  'IQD',
  false,
  wallet.id,
  wayl.id,
  NULL,
  'Online payment',
  receivable.id,
  concat('WAYL:STATEMENT:', match.code, ':GROSS'),
  CASE WHEN match.order_id IS NULL
    THEN 'Wayl payment awaiting order match'
    ELSE 'Wayl pooled statement allocation to customer invoice'
  END,
  match.code,
  match.branch_id,
  match.order_id,
  CURRENT_TIMESTAMP
FROM "_wayl_match" match
JOIN "Party" wayl ON wayl."externalKey" = 'WAYL'
JOIN "FinanceAccount" wallet ON wallet."externalKey" = 'WAYL_WALLET'
LEFT JOIN "Order" orders ON orders.id = match.order_id
LEFT JOIN LATERAL (
  SELECT obligation.id
  FROM "FinanceEntry" obligation
  WHERE
    obligation."orderId" = match.order_id
    AND obligation.obligation = true
    AND obligation."obligationKind" = 'RECEIVABLE'
    AND obligation."archivedAt" IS NULL
    AND obligation."reversedAt" IS NULL
    AND obligation."reversalOfId" IS NULL
  ORDER BY obligation."createdAt"
  LIMIT 1
) receivable ON true
ON CONFLICT ("importKey") DO UPDATE
SET
  amount = EXCLUDED.amount,
  "accountId" = EXCLUDED."accountId",
  "settlesId" = EXCLUDED."settlesId",
  "orderId" = EXCLUDED."orderId",
  reference = EXCLUDED.reference,
  "archivedAt" = NULL,
  "archiveReason" = NULL;

INSERT INTO "FinanceEntry" (
  id, date, type, "recordClass", amount, currency, obligation, "accountId",
  "partyId", "categoryType", "costRole", "paymentMethod", "importKey",
  description, reference, "branchId", "orderId", "createdAt"
)
SELECT
  concat('wayl-statement-fee-', match.code),
  match.occurred_at,
  'EXPENSE',
  'EXPENSE',
  match.fee,
  'IQD',
  false,
  wallet.id,
  wayl.id,
  'TECH',
  'PAYMENT_PROCESSING',
  'Online payment',
  concat('WAYL:STATEMENT:', match.code, ':FEE'),
  'Wayl statement commission',
  match.code,
  match.branch_id,
  match.order_id,
  CURRENT_TIMESTAMP
FROM "_wayl_match" match
JOIN "Party" wayl ON wayl."externalKey" = 'WAYL'
JOIN "FinanceAccount" wallet ON wallet."externalKey" = 'WAYL_WALLET'
ON CONFLICT ("importKey") DO UPDATE
SET
  amount = EXCLUDED.amount,
  "accountId" = EXCLUDED."accountId",
  "archivedAt" = NULL,
  "archiveReason" = NULL;

INSERT INTO "LedgerEntryLine" (
  id, "financeEntryId", "lineNo", "itemType", "itemName", "categoryType",
  unit, quantity, "unitCost", "landedUnitCost", "lineTotal", "branchId",
  "spendTreatment", "classificationStatus", "classificationSource"
)
SELECT
  concat('wayl-statement-fee-line-', match.code),
  fee.id,
  1,
  'SERVICE',
  'Wayl payment processing',
  'TECH',
  'service',
  1,
  match.fee,
  match.fee,
  match.fee,
  match.branch_id,
  'OPEX',
  'CONFIRMED',
  'wayl-statement'
FROM "_wayl_match" match
JOIN "FinanceEntry" fee ON fee."importKey" = concat('WAYL:STATEMENT:', match.code, ':FEE')
ON CONFLICT ("financeEntryId", "lineNo") DO UPDATE
SET
  "lineTotal" = EXCLUDED."lineTotal",
  "unitCost" = EXCLUDED."unitCost",
  "landedUnitCost" = EXCLUDED."landedUnitCost";

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "obligationKind", "partyId",
  "importKey", description, reference, "createdAt"
)
SELECT
  concat('wayl-unmatched-deposit-liability-', match.code),
  match.occurred_at,
  'INCOME',
  match.gross,
  'IQD',
  true,
  'PAYABLE',
  wayl.id,
  concat('WAYL:STATEMENT:', match.code, ':CUSTOMER_DEPOSIT'),
  'Unmatched online customer deposit',
  match.code,
  CURRENT_TIMESTAMP
FROM "_wayl_match" match
JOIN "Party" wayl ON wayl."externalKey" = 'WAYL'
WHERE match.order_id IS NULL
ON CONFLICT ("importKey") DO UPDATE
SET amount = EXCLUDED.amount, "archivedAt" = NULL, "archiveReason" = NULL;

INSERT INTO "PaymentReconciliationItem" (
  id, "providerPartyId", "orderId", "occurredAt", "externalCode",
  "sourceReference", "grossAmount", "feeAmount", "netAmount", status,
  "receiptEntryId", "feeEntryId", metadata, "createdAt", "updatedAt"
)
SELECT
  concat('wayl-reconciliation-', match.code),
  wayl.id,
  match.order_id,
  match.occurred_at,
  match.code,
  'wallet-transactions-all-time.csv',
  match.gross,
  match.fee,
  match.gross - match.fee,
  CASE WHEN match.order_id IS NULL
    THEN 'NEEDS_ORDER'::"PaymentReconciliationStatus"
    ELSE 'LINKED'::"PaymentReconciliationStatus"
  END,
  receipt.id,
  fee.id,
  jsonb_build_object(
    'source', 'Wayl wallet statement',
    'feeRule', 'floor(3.5% of gross + 600 IQD)',
    'statementOverride', true,
    'allocationMode', CASE
      WHEN match.order_id IS NULL THEN 'unmatched-source-receipt'
      ELSE 'matched-statement-pool'
    END,
    'sourceGrossAmount', match.gross,
    'allocatedInvoiceAmount', CASE
      WHEN match.order_id IS NULL THEN match.gross
      ELSE GREATEST(
        orders."grossAmount" - orders."discountAmount" - orders."refundAmount"
          + orders."deliveryFee" + orders."extraCharges",
        0
      )
    END
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_wayl_match" match
JOIN "Party" wayl ON wayl."externalKey" = 'WAYL'
JOIN "FinanceEntry" receipt ON receipt."importKey" = concat('WAYL:STATEMENT:', match.code, ':GROSS')
JOIN "FinanceEntry" fee ON fee."importKey" = concat('WAYL:STATEMENT:', match.code, ':FEE')
LEFT JOIN "Order" orders ON orders.id = match.order_id
ON CONFLICT ("providerPartyId", "externalCode") DO UPDATE
SET
  "orderId" = EXCLUDED."orderId",
  "grossAmount" = EXCLUDED."grossAmount",
  "feeAmount" = EXCLUDED."feeAmount",
  "netAmount" = EXCLUDED."netAmount",
  status = EXCLUDED.status,
  "receiptEntryId" = EXCLUDED."receiptEntryId",
  "feeEntryId" = EXCLUDED."feeEntryId",
  metadata = EXCLUDED.metadata,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", metadata)
SELECT
  concat('audit-wayl-statement-allocation-', match.code),
  owner_user.id,
  'ALLOCATE_WAYL_STATEMENT_POOL',
  'PaymentReconciliationItem',
  concat('wayl-reconciliation-', match.code),
  jsonb_build_object(
    'externalCode', match.code,
    'orderId', match.order_id,
    'orderNumber', orders."orderNumber",
    'sourceGrossAmount', match.gross,
    'allocatedInvoiceAmount', GREATEST(
      orders."grossAmount" - orders."discountAmount" - orders."refundAmount"
        + orders."deliveryFee" + orders."extraCharges",
      0
    ),
    'allocationDifference', GREATEST(
      orders."grossAmount" - orders."discountAmount" - orders."refundAmount"
        + orders."deliveryFee" + orders."extraCharges",
      0
    ) - match.gross,
    'policy', 'Seven matched statement receipts equal seven matched invoices in aggregate.'
  )
FROM "_wayl_match" match
JOIN "Order" orders ON orders.id = match.order_id
LEFT JOIN LATERAL (
  SELECT id
  FROM "User"
  WHERE role IN ('OWNER', 'ADMIN')
  ORDER BY "createdAt"
  LIMIT 1
) owner_user ON true
WHERE match.order_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Statement payouts are transfers, never extra income.
CREATE TEMP TABLE "_wayl_payout" (
  payout_date TIMESTAMP(3) PRIMARY KEY,
  amount INTEGER NOT NULL
) ON COMMIT DROP;

INSERT INTO "_wayl_payout" (payout_date, amount) VALUES
  ('2026-05-26T00:00:00+03:00', 87346),
  ('2026-06-02T00:00:00+03:00', 20630),
  ('2026-06-09T00:00:00+03:00', 35471),
  ('2026-06-30T00:00:00+03:00', 12428),
  ('2026-07-07T00:00:00+03:00', 20630),
  ('2026-07-21T00:00:00+03:00', 26420);

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "accountId", "toAccountId",
  "paymentMethod", "importKey", description, reference, "createdAt"
)
SELECT
  concat('wayl-payout-', to_char(payout.payout_date, 'YYYYMMDD')),
  payout.payout_date,
  'TRANSFER',
  payout.amount,
  'IQD',
  false,
  wallet.id,
  fib.id,
  'Bank transfer',
  concat('WAYL:PAYOUT:', to_char(payout.payout_date, 'YYYY-MM-DD')),
  'Wayl payout to FIB',
  concat('WAYL-', to_char(payout.payout_date, 'YYYY-MM-DD')),
  CURRENT_TIMESTAMP
FROM "_wayl_payout" payout
JOIN "FinanceAccount" wallet ON wallet."externalKey" = 'WAYL_WALLET'
JOIN "FinanceAccount" fib ON fib."externalKey" = 'FIB'
ON CONFLICT ("importKey") DO UPDATE
SET amount = EXCLUDED.amount, "accountId" = EXCLUDED."accountId", "toAccountId" = EXCLUDED."toAccountId";

-- Attribute every corrective finance row to an Owner/Admin system actor.
UPDATE "FinanceEntry"
SET "createdById" = (
  SELECT id
  FROM "User"
  WHERE role IN ('OWNER', 'ADMIN')
  ORDER BY "createdAt"
  LIMIT 1
)
WHERE "createdById" IS NULL
  AND (
    "importKey" LIKE 'WAYL:%'
    OR "importKey" LIKE 'ORDER:%:UNASSIGNED_COURIER:FEE'
  );

INSERT INTO "Setting" ("key", value, "updatedAt")
VALUES
  ('wayl_statement_gross', '275000', CURRENT_TIMESTAMP),
  ('wayl_statement_commission', '16822', CURRENT_TIMESTAMP),
  ('wayl_statement_payouts', '202925', CURRENT_TIMESTAMP),
  ('wayl_statement_wallet_balance', '55253', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET value = EXCLUDED.value, "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "Setting" ("key", value, "updatedAt")
SELECT setting.key, setting.value, CURRENT_TIMESTAMP
FROM (
  VALUES
    ('finance_integrity_expected_total_spending', '29537034'),
    ('finance_integrity_expected_capex', '16593130'),
    ('finance_integrity_expected_inventory', '9150373'),
    ('finance_integrity_expected_operating', '3793531'),
    ('finance_integrity_expected_sales', '2395000'),
    ('finance_integrity_expected_sale_orders', '97'),
    ('finance_integrity_expected_promotion_orders', '5'),
    ('finance_integrity_expected_cutoff', CURRENT_TIMESTAMP::text),
    ('finance_integrity_correction_version', '2026-07-28-v4')
) setting(key, value)
WHERE EXISTS (SELECT 1 FROM "FinanceEntry" WHERE "recordKey" = 'DOC000144')
ON CONFLICT ("key") DO UPDATE
SET value = EXCLUDED.value, "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", metadata)
SELECT
  'audit-finance-integrity-wayl-20260728-v4',
  owner_user.id,
  'FINANCE_INTEGRITY_CORRECTION',
  'Finance',
  '2026-07-28-v4',
  jsonb_build_object(
    'brandingAsset', 6000000,
    'espressoToolsCapex', 100000,
    'inventoryFreight', 928000,
    'pickupCostCleared', 40000,
    'waylGross', 275000,
    'waylCommission', 16822,
    'waylPayouts', 202925,
    'waylWalletBalance', 55253,
    'expectedCapex', 16593130,
    'expectedInventory', 9150373,
    'expectedOperating', 3793531,
    'expectedTotalSpending', 29537034,
    'note', 'Targets reflect the approved reversal of the unsupported IQD 13,500 payment.'
  )
FROM (SELECT 1) seed
LEFT JOIN LATERAL (
  SELECT id FROM "User" WHERE role IN ('OWNER', 'ADMIN') ORDER BY "createdAt" LIMIT 1
) owner_user ON true
ON CONFLICT (id) DO NOTHING;

COMMIT;
