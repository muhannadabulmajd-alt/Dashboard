-- Finance central entry panel: decimal stock quantities, linked assets, and archive metadata.

ALTER TABLE "ProductComponent"
  ALTER COLUMN "quantity" TYPE DECIMAL(14,3) USING "quantity"::DECIMAL(14,3),
  ALTER COLUMN "quantity" SET DEFAULT 1,
  ALTER COLUMN "unitCost" TYPE DECIMAL(14,3) USING "unitCost"::DECIMAL(14,3);

ALTER TABLE "InventoryItem"
  ALTER COLUMN "reorderPoint" TYPE DECIMAL(14,3) USING "reorderPoint"::DECIMAL(14,3),
  ALTER COLUMN "unitCost" TYPE DECIMAL(14,3) USING "unitCost"::DECIMAL(14,3);

ALTER TABLE "InventoryCostLayer"
  ADD COLUMN "financeEntryId" TEXT,
  ALTER COLUMN "qtyReceived" TYPE DECIMAL(14,3) USING "qtyReceived"::DECIMAL(14,3),
  ALTER COLUMN "unitCost" TYPE DECIMAL(14,3) USING "unitCost"::DECIMAL(14,3);

ALTER TABLE "StockMovement"
  ADD COLUMN "financeEntryId" TEXT,
  ALTER COLUMN "quantity" TYPE DECIMAL(14,3) USING "quantity"::DECIMAL(14,3);

ALTER TABLE "FinanceEntry"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedById" TEXT,
  ADD COLUMN "archiveReason" TEXT;

CREATE TABLE "FixedAsset" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL DEFAULT 1,
  "unit" TEXT NOT NULL,
  "totalCost" INTEGER NOT NULL,
  "unitCost" DECIMAL(14,3) NOT NULL,
  "purchaseDate" TIMESTAMP(3) NOT NULL,
  "partyId" TEXT,
  "branchId" TEXT,
  "financeEntryId" TEXT,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "archivedAt" TIMESTAMP(3),
  "archivedById" TEXT,
  "archiveReason" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FixedAsset_financeEntryId_key" ON "FixedAsset"("financeEntryId");
CREATE INDEX "FixedAsset_category_idx" ON "FixedAsset"("category");
CREATE INDEX "FixedAsset_partyId_idx" ON "FixedAsset"("partyId");
CREATE INDEX "FixedAsset_branchId_idx" ON "FixedAsset"("branchId");
CREATE INDEX "FixedAsset_isActive_idx" ON "FixedAsset"("isActive");
CREATE INDEX "InventoryCostLayer_financeEntryId_idx" ON "InventoryCostLayer"("financeEntryId");
CREATE INDEX "StockMovement_financeEntryId_idx" ON "StockMovement"("financeEntryId");
CREATE INDEX "FinanceEntry_archivedAt_idx" ON "FinanceEntry"("archivedAt");

ALTER TABLE "InventoryCostLayer"
  ADD CONSTRAINT "InventoryCostLayer_financeEntryId_fkey"
  FOREIGN KEY ("financeEntryId") REFERENCES "FinanceEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_financeEntryId_fkey"
  FOREIGN KEY ("financeEntryId") REFERENCES "FinanceEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FixedAsset"
  ADD CONSTRAINT "FixedAsset_partyId_fkey"
  FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FixedAsset"
  ADD CONSTRAINT "FixedAsset_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FixedAsset"
  ADD CONSTRAINT "FixedAsset_financeEntryId_fkey"
  FOREIGN KEY ("financeEntryId") REFERENCES "FinanceEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
