-- Atlas location-based inventory foundation. This migration is additive and
-- keeps legacy branch fields available for rollback and reconciliation.

BEGIN;

-- CreateEnum
CREATE TYPE "StockLocationType" AS ENUM ('RAW_WAREHOUSE', 'ROASTERY', 'PACKING', 'FINISHED_WAREHOUSE', 'SALES_POINT', 'IN_TRANSIT', 'QUARANTINE', 'GENERAL');

-- CreateEnum
CREATE TYPE "StockDocumentType" AS ENUM ('OPENING', 'PURCHASE_RECEIPT', 'ROAST', 'PACK', 'TRANSFER', 'SALE', 'RETURN', 'COUNT', 'ADJUSTMENT', 'WASTE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "StockDocumentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'DISPATCHED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "StockReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InventoryCountStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InventoryCountKind" AS ENUM ('ROUTINE', 'OPENING');

-- CreateEnum
CREATE TYPE "ReplenishmentStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockDiscrepancyType" AS ENUM ('SHORTAGE', 'DAMAGE', 'EXCESS');

-- CreateEnum
CREATE TYPE "StockDiscrepancyStatus" AS ENUM ('OPEN', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReturnDisposition" AS ENUM ('RESTOCK', 'REPACK', 'RETURN_TO_SUPPLIER', 'WASTE');

-- CreateEnum
CREATE TYPE "LocalExpenseRequestStatus" AS ENUM ('SUBMITTED', 'POSTED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'RETURN_IN';
ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'QUARANTINE';
ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'RESTOCK';
ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'REPACK';
ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'RETURN_TO_SUPPLIER';
ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'REVERSAL';

ALTER TYPE "FinanceType" ADD VALUE IF NOT EXISTS 'INVENTORY_GAIN';
ALTER TYPE "FinanceType" ADD VALUE IF NOT EXISTS 'INVENTORY_LOSS';

-- AlterEnum
ALTER TYPE "InventoryCategory" ADD VALUE IF NOT EXISTS 'FINISHED_GOOD';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "defaultStockLocationId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "fulfillmentLocationId" TEXT;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "cogsTotalSnapshot" INTEGER;

-- AlterTable
ALTER TABLE "RoastBatch" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "stockDocumentId" TEXT,
ADD COLUMN     "abnormalLossGrams" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InventoryCostLayer" ADD COLUMN     "bestBefore" TIMESTAMP(3),
ADD COLUMN     "lotNumber" TEXT,
ADD COLUMN     "packedAt" TIMESTAMP(3),
ADD COLUMN     "roastDate" TIMESTAMP(3),
ADD COLUMN     "stockDocumentId" TEXT,
ADD COLUMN     "supplierLot" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "costLayerId" TEXT,
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "orderLineId" TEXT,
ADD COLUMN     "stockDocumentId" TEXT;

-- AlterTable
ALTER TABLE "FinanceAccount" ADD COLUMN     "stockLocationId" TEXT;

-- AlterTable
ALTER TABLE "FinanceEntry" ADD COLUMN     "stockLocationId" TEXT,
ADD COLUMN     "inventoryCountId" TEXT,
ADD COLUMN     "accountingCode" TEXT,
ADD COLUMN     "isOpeningBalance" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProductRecipeVersion" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductRecipeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRecipeComponent" (
    "id" TEXT NOT NULL,
    "recipeVersionId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,3) NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductRecipeComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLocation" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "type" "StockLocationType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isCentralFulfillment" BOOLEAN NOT NULL DEFAULT false,
    "stockVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLocationAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canSell" BOOLEAN NOT NULL DEFAULT false,
    "canReceive" BOOLEAN NOT NULL DEFAULT false,
    "canCount" BOOLEAN NOT NULL DEFAULT false,
    "canRecordExpense" BOOLEAN NOT NULL DEFAULT false,
    "canProduce" BOOLEAN NOT NULL DEFAULT false,
    "canDispatch" BOOLEAN NOT NULL DEFAULT false,
    "canApprove" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLocationAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLocationPolicy" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "reorderPoint" DECIMAL(14,3),
    "targetLevel" DECIMAL(14,3),
    "canSell" BOOLEAN NOT NULL DEFAULT false,
    "canProduce" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryLocationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryVariancePolicy" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "openingBalanceAccountCode" TEXT,
    "inventoryGainAccountCode" TEXT,
    "inventoryLossAccountCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryVariancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockDocument" (
    "id" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "type" "StockDocumentType" NOT NULL,
    "status" "StockDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceLocationId" TEXT,
    "destinationLocationId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "expectedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "reason" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "confirmedById" TEXT,
    "partyId" TEXT,
    "parentDocumentId" TEXT,
    "reversalOfId" TEXT,
    "returnDisposition" "ReturnDisposition",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT,
    "orderLineId" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingBatch" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "outputInventoryItemId" TEXT NOT NULL,
    "recipeVersionId" TEXT,
    "stockDocumentId" TEXT NOT NULL,
    "outputLotId" TEXT,
    "outputQuantity" DECIMAL(14,3) NOT NULL,
    "rejectedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "packedAt" TIMESTAMP(3) NOT NULL,
    "bestBefore" TIMESTAMP(3),
    "totalCost" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,3) NOT NULL,
    "notes" TEXT,
    "operatorId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingBatchComponent" (
    "id" TEXT NOT NULL,
    "packingBatchId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "costLayerId" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackingBatchComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCount" (
    "id" TEXT NOT NULL,
    "countNumber" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "kind" "InventoryCountKind" NOT NULL DEFAULT 'ROUTINE',
    "status" "InventoryCountStatus" NOT NULL DEFAULT 'SUBMITTED',
    "countedAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "locationVersionSnapshot" INTEGER NOT NULL,
    "openingAttestation" TEXT,
    "openingAttestedAt" TIMESTAMP(3),
    "submittedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "stockDocumentId" TEXT,
    "idempotencyKey" TEXT,
    "reviewIdempotencyKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCountLine" (
    "id" TEXT NOT NULL,
    "inventoryCountId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "expectedQuantity" DECIMAL(14,3) NOT NULL,
    "countedQuantity" DECIMAL(14,3) NOT NULL,
    "difference" DECIMAL(14,3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "InventoryCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReplenishmentRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sourceLocationId" TEXT,
    "orderId" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "status" "ReplenishmentStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "reviewIdempotencyKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockReplenishmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockDiscrepancy" (
    "id" TEXT NOT NULL,
    "stockDocumentId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "type" "StockDiscrepancyType" NOT NULL,
    "status" "StockDiscrepancyStatus" NOT NULL DEFAULT 'OPEN',
    "quantity" DECIMAL(14,3) NOT NULL,
    "reportedUnitCost" DECIMAL(14,3),
    "stockEffectPending" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "reportedById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "resolution" TEXT,
    "resolutionDocumentId" TEXT,
    "financeEntryId" TEXT,
    "reviewIdempotencyKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockDiscrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductRecipeVersion_productId_isActive_idx" ON "ProductRecipeVersion"("productId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRecipeVersion_productId_version_key" ON "ProductRecipeVersion"("productId", "version");

-- CreateIndex
CREATE INDEX "ProductRecipeComponent_recipeVersionId_idx" ON "ProductRecipeComponent"("recipeVersionId");

-- CreateIndex
CREATE INDEX "ProductRecipeComponent_inventoryItemId_idx" ON "ProductRecipeComponent"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_code_key" ON "StockLocation"("code");

-- CreateIndex
CREATE INDEX "StockLocation_branchId_type_isActive_idx" ON "StockLocation"("branchId", "type", "isActive");

-- CreateIndex
CREATE INDEX "StockLocation_isCentralFulfillment_idx" ON "StockLocation"("isCentralFulfillment");

-- CreateIndex
CREATE INDEX "UserLocationAccess_locationId_idx" ON "UserLocationAccess"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "UserLocationAccess_userId_locationId_key" ON "UserLocationAccess"("userId", "locationId");

-- CreateIndex
CREATE INDEX "InventoryLocationPolicy_locationId_isActive_idx" ON "InventoryLocationPolicy"("locationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLocationPolicy_inventoryItemId_locationId_key" ON "InventoryLocationPolicy"("inventoryItemId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryVariancePolicy_locationId_key" ON "InventoryVariancePolicy"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocument_documentNumber_key" ON "StockDocument"("documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocument_idempotencyKey_key" ON "StockDocument"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockDocument_type_status_occurredAt_idx" ON "StockDocument"("type", "status", "occurredAt");

-- CreateIndex
CREATE INDEX "StockDocument_sourceLocationId_idx" ON "StockDocument"("sourceLocationId");

-- CreateIndex
CREATE INDEX "StockDocument_destinationLocationId_idx" ON "StockDocument"("destinationLocationId");

-- CreateIndex
CREATE INDEX "StockDocument_createdById_idx" ON "StockDocument"("createdById");

-- CreateIndex
CREATE INDEX "StockDocument_partyId_idx" ON "StockDocument"("partyId");

-- CreateIndex
CREATE INDEX "StockDocument_parentDocumentId_idx" ON "StockDocument"("parentDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocument_reversalOfId_key" ON "StockDocument"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "StockReservation_idempotencyKey_key" ON "StockReservation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockReservation_locationId_inventoryItemId_status_idx" ON "StockReservation"("locationId", "inventoryItemId", "status");

-- CreateIndex
CREATE INDEX "StockReservation_orderId_idx" ON "StockReservation"("orderId");

-- CreateIndex
CREATE INDEX "StockReservation_expiresAt_status_idx" ON "StockReservation"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PackingBatch_batchNumber_key" ON "PackingBatch"("batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PackingBatch_stockDocumentId_key" ON "PackingBatch"("stockDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "PackingBatch_outputLotId_key" ON "PackingBatch"("outputLotId");

-- CreateIndex
CREATE UNIQUE INDEX "PackingBatch_idempotencyKey_key" ON "PackingBatch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PackingBatch_locationId_packedAt_idx" ON "PackingBatch"("locationId", "packedAt");

-- CreateIndex
CREATE INDEX "PackingBatch_productId_packedAt_idx" ON "PackingBatch"("productId", "packedAt");

-- CreateIndex
CREATE INDEX "PackingBatch_operatorId_idx" ON "PackingBatch"("operatorId");

-- CreateIndex
CREATE INDEX "PackingBatchComponent_packingBatchId_idx" ON "PackingBatchComponent"("packingBatchId");

-- CreateIndex
CREATE INDEX "PackingBatchComponent_inventoryItemId_idx" ON "PackingBatchComponent"("inventoryItemId");

-- CreateIndex
CREATE INDEX "PackingBatchComponent_costLayerId_idx" ON "PackingBatchComponent"("costLayerId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCount_countNumber_key" ON "InventoryCount"("countNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCount_stockDocumentId_key" ON "InventoryCount"("stockDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCount_idempotencyKey_key" ON "InventoryCount"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCount_reviewIdempotencyKey_key" ON "InventoryCount"("reviewIdempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryCount_locationId_kind_status_countedAt_idx" ON "InventoryCount"("locationId", "kind", "status", "countedAt");

-- An opening count may be retried after rejection, but a location can never
-- have two submitted/approved opening snapshots.
CREATE UNIQUE INDEX "InventoryCount_one_live_opening_per_location_key"
ON "InventoryCount"("locationId")
WHERE "kind" = 'OPENING'::"InventoryCountKind"
  AND "status" IN ('SUBMITTED'::"InventoryCountStatus", 'APPROVED'::"InventoryCountStatus");

-- CreateIndex
CREATE INDEX "InventoryCount_submittedById_idx" ON "InventoryCount"("submittedById");

-- CreateIndex
CREATE INDEX "InventoryCount_approvedById_idx" ON "InventoryCount"("approvedById");

-- CreateIndex
CREATE INDEX "InventoryCount_rejectedById_idx" ON "InventoryCount"("rejectedById");

-- CreateIndex
CREATE INDEX "InventoryCountLine_inventoryItemId_idx" ON "InventoryCountLine"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCountLine_inventoryCountId_inventoryItemId_key" ON "InventoryCountLine"("inventoryCountId", "inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockReplenishmentRequest_requestNumber_key" ON "StockReplenishmentRequest"("requestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StockReplenishmentRequest_idempotencyKey_key" ON "StockReplenishmentRequest"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "StockReplenishmentRequest_reviewIdempotencyKey_key" ON "StockReplenishmentRequest"("reviewIdempotencyKey");

-- CreateIndex
CREATE INDEX "StockReplenishmentRequest_locationId_status_idx" ON "StockReplenishmentRequest"("locationId", "status");

-- CreateIndex
CREATE INDEX "StockReplenishmentRequest_sourceLocationId_idx" ON "StockReplenishmentRequest"("sourceLocationId");

-- CreateIndex
CREATE INDEX "StockReplenishmentRequest_inventoryItemId_idx" ON "StockReplenishmentRequest"("inventoryItemId");

-- CreateIndex
CREATE INDEX "StockReplenishmentRequest_orderId_idx" ON "StockReplenishmentRequest"("orderId");

-- CreateIndex
CREATE INDEX "StockReplenishmentRequest_reviewedById_idx" ON "StockReplenishmentRequest"("reviewedById");

-- CreateIndex
CREATE INDEX "StockDiscrepancy_stockDocumentId_status_idx" ON "StockDiscrepancy"("stockDocumentId", "status");

-- CreateIndex
CREATE INDEX "StockDiscrepancy_inventoryItemId_idx" ON "StockDiscrepancy"("inventoryItemId");

-- CreateIndex
CREATE INDEX "StockDiscrepancy_reportedById_idx" ON "StockDiscrepancy"("reportedById");

-- CreateIndex
CREATE INDEX "StockDiscrepancy_resolvedById_idx" ON "StockDiscrepancy"("resolvedById");

-- CreateIndex
CREATE UNIQUE INDEX "StockDiscrepancy_resolutionDocumentId_key" ON "StockDiscrepancy"("resolutionDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "StockDiscrepancy_financeEntryId_key" ON "StockDiscrepancy"("financeEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "StockDiscrepancy_reviewIdempotencyKey_key" ON "StockDiscrepancy"("reviewIdempotencyKey");

-- CreateIndex
CREATE INDEX "User_defaultStockLocationId_idx" ON "User"("defaultStockLocationId");

-- CreateIndex
CREATE INDEX "Order_fulfillmentLocationId_idx" ON "Order"("fulfillmentLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "RoastBatch_stockDocumentId_key" ON "RoastBatch"("stockDocumentId");

-- CreateIndex
CREATE INDEX "RoastBatch_locationId_idx" ON "RoastBatch"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCostLayer_lotNumber_key" ON "InventoryCostLayer"("lotNumber");

-- CreateIndex
CREATE INDEX "InventoryCostLayer_stockDocumentId_idx" ON "InventoryCostLayer"("stockDocumentId");

-- CreateIndex
CREATE INDEX "InventoryCostLayer_bestBefore_idx" ON "InventoryCostLayer"("bestBefore");

-- CreateIndex
CREATE INDEX "StockMovement_locationId_inventoryItemId_occurredAt_idx" ON "StockMovement"("locationId", "inventoryItemId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_stockDocumentId_idx" ON "StockMovement"("stockDocumentId");

-- CreateIndex
CREATE INDEX "StockMovement_costLayerId_idx" ON "StockMovement"("costLayerId");

-- CreateIndex
CREATE INDEX "StockMovement_orderLineId_idx" ON "StockMovement"("orderLineId");

-- CreateIndex
CREATE INDEX "FinanceAccount_stockLocationId_idx" ON "FinanceAccount"("stockLocationId");

-- CreateIndex
CREATE INDEX "FinanceEntry_stockLocationId_idx" ON "FinanceEntry"("stockLocationId");

-- CreateIndex
CREATE INDEX "FinanceEntry_inventoryCountId_idx" ON "FinanceEntry"("inventoryCountId");

-- CreateIndex
CREATE INDEX "FinanceEntry_accountingCode_idx" ON "FinanceEntry"("accountingCode");

-- CreateIndex
CREATE INDEX "FinanceEntry_isOpeningBalance_idx" ON "FinanceEntry"("isOpeningBalance");

-- A posted finance entry may have only one reversal marker. The inventory
-- cutover preflight reports any historical duplicates before this is applied.
DROP INDEX IF EXISTS "FinanceEntry_reversalOfId_idx";
CREATE UNIQUE INDEX "FinanceEntry_reversalOfId_key" ON "FinanceEntry"("reversalOfId");

-- Create one neutral operating location plus isolated transit and quarantine
-- locations for every existing branch. Central fulfillment is intentionally
-- left unset and must be selected by an Owner/Admin after reconciliation.
INSERT INTO "StockLocation" (
    "id", "branchId", "code", "nameEn", "nameAr", "type",
    "isActive", "isSystem", "isCentralFulfillment", "createdAt", "updatedAt"
)
SELECT
    'loc_' || substr(md5(b."id" || ':main'), 1, 24),
    b."id",
    b."code" || '-MAIN',
    b."nameEn" || ' Main stock',
    b."nameAr" || ' / Main stock',
    'GENERAL'::"StockLocationType",
    b."isActive",
    false,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Branch" b;

INSERT INTO "StockLocation" (
    "id", "branchId", "code", "nameEn", "nameAr", "type",
    "isActive", "isSystem", "isCentralFulfillment", "createdAt", "updatedAt"
)
SELECT
    'loc_' || substr(md5(b."id" || ':transit'), 1, 24),
    b."id",
    b."code" || '-TRANSIT',
    b."nameEn" || ' In transit',
    b."nameAr" || ' / In transit',
    'IN_TRANSIT'::"StockLocationType",
    b."isActive",
    true,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Branch" b;

INSERT INTO "StockLocation" (
    "id", "branchId", "code", "nameEn", "nameAr", "type",
    "isActive", "isSystem", "isCentralFulfillment", "createdAt", "updatedAt"
)
SELECT
    'loc_' || substr(md5(b."id" || ':quarantine'), 1, 24),
    b."id",
    b."code" || '-QUARANTINE',
    b."nameEn" || ' Quarantine',
    b."nameAr" || ' / Quarantine',
    'QUARANTINE'::"StockLocationType",
    b."isActive",
    true,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Branch" b;

-- Preserve current single-branch access as the initial default location.
UPDATE "User" u
SET "defaultStockLocationId" = sl."id"
FROM "StockLocation" sl
WHERE u."branchId" = sl."branchId"
  AND sl."type" = 'GENERAL'::"StockLocationType"
  AND sl."isSystem" = false;

INSERT INTO "UserLocationAccess" (
    "id", "userId", "locationId", "canView", "canSell", "canReceive",
    "canCount", "canRecordExpense", "canProduce", "canDispatch",
    "canApprove", "createdAt", "updatedAt"
)
SELECT
    'ula_' || substr(md5(u."id" || ':' || sl."id"), 1, 24),
    u."id",
    sl."id",
    true,
    u."role"::text IN ('OWNER', 'ADMIN', 'BRANCH_MANAGER', 'SALES_CRM'),
    u."role"::text IN ('OWNER', 'ADMIN', 'BRANCH_MANAGER', 'ROASTERY_OPS'),
    u."role"::text IN ('OWNER', 'ADMIN', 'BRANCH_MANAGER'),
    u."role"::text IN ('OWNER', 'ADMIN', 'BRANCH_MANAGER', 'FINANCE'),
    u."role"::text IN ('OWNER', 'ADMIN', 'ROASTERY_OPS'),
    u."role"::text IN ('OWNER', 'ADMIN', 'ROASTERY_OPS'),
    u."role"::text IN ('OWNER', 'ADMIN'),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User" u
JOIN "StockLocation" sl
  ON sl."branchId" = u."branchId"
 AND sl."type" = 'GENERAL'::"StockLocationType"
 AND sl."isSystem" = false
WHERE u."branchId" IS NOT NULL;

-- Location policies preserve existing item reorder settings without silently
-- granting production rights. Product-linked items remain locally sellable.
INSERT INTO "InventoryLocationPolicy" (
    "id", "inventoryItemId", "locationId", "reorderPoint", "targetLevel",
    "canSell", "canProduce", "isActive", "createdAt", "updatedAt"
)
SELECT
    'ilp_' || substr(md5(ii."id" || ':' || sl."id"), 1, 24),
    ii."id",
    sl."id",
    ii."reorderPoint",
    NULL,
    ii."productId" IS NOT NULL,
    false,
    ii."isActive" AND sl."isActive",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "InventoryItem" ii
JOIN "StockLocation" sl
  ON sl."branchId" = ii."branchId"
 AND sl."type" = 'GENERAL'::"StockLocationType"
 AND sl."isSystem" = false
WHERE ii."branchId" IS NOT NULL;

-- Snapshot the current editable product components as recipe version 1.
INSERT INTO "ProductRecipeVersion" (
    "id", "productId", "version", "effectiveFrom", "isActive", "notes", "createdAt"
)
SELECT
    'rv_' || substr(md5(pc."productId" || ':1'), 1, 24),
    pc."productId",
    1,
    min(pc."createdAt"),
    true,
    'Opening recipe snapshot created by Inventory V2 migration',
    CURRENT_TIMESTAMP
FROM "ProductComponent" pc
GROUP BY pc."productId";

INSERT INTO "ProductRecipeComponent" (
    "id", "recipeVersionId", "inventoryItemId", "name", "quantity",
    "unitCost", "isRequired", "createdAt"
)
SELECT
    'rvc_' || substr(md5(pc."id" || ':1'), 1, 24),
    'rv_' || substr(md5(pc."productId" || ':1'), 1, 24),
    pc."inventoryItemId",
    pc."name",
    pc."quantity",
    pc."unitCost",
    true,
    pc."createdAt"
FROM "ProductComponent" pc;

-- Backfill only references with an unambiguous branch. Rows with neither a
-- movement branch nor an item branch stay NULL and are surfaced by preflight.
UPDATE "StockMovement" sm
SET "locationId" = sl."id"
FROM "InventoryItem" ii, "StockLocation" sl
WHERE sm."inventoryItemId" = ii."id"
  AND sl."branchId" = COALESCE(sm."branchId", ii."branchId")
  AND sl."type" = 'GENERAL'::"StockLocationType"
  AND sl."isSystem" = false
  AND sm."locationId" IS NULL;

UPDATE "RoastBatch" rb
SET "locationId" = sl."id"
FROM "StockLocation" sl
WHERE rb."branchId" = sl."branchId"
  AND sl."type" = 'GENERAL'::"StockLocationType"
  AND sl."isSystem" = false
  AND rb."locationId" IS NULL;

UPDATE "Order" o
SET "fulfillmentLocationId" = sl."id"
FROM "StockLocation" sl
WHERE o."branchId" = sl."branchId"
  AND sl."type" = 'GENERAL'::"StockLocationType"
  AND sl."isSystem" = false
  AND o."fulfillmentLocationId" IS NULL;

UPDATE "FinanceAccount" fa
SET "stockLocationId" = sl."id"
FROM "StockLocation" sl
WHERE fa."branchId" = sl."branchId"
  AND sl."type" = 'GENERAL'::"StockLocationType"
  AND sl."isSystem" = false
  AND fa."stockLocationId" IS NULL;

UPDATE "FinanceEntry" fe
SET "stockLocationId" = sl."id"
FROM "StockLocation" sl
WHERE fe."branchId" = sl."branchId"
  AND sl."type" = 'GENERAL'::"StockLocationType"
  AND sl."isSystem" = false
  AND fe."stockLocationId" IS NULL;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_defaultStockLocationId_fkey" FOREIGN KEY ("defaultStockLocationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecipeVersion" ADD CONSTRAINT "ProductRecipeVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecipeVersion" ADD CONSTRAINT "ProductRecipeVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecipeComponent" ADD CONSTRAINT "ProductRecipeComponent_recipeVersionId_fkey" FOREIGN KEY ("recipeVersionId") REFERENCES "ProductRecipeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecipeComponent" ADD CONSTRAINT "ProductRecipeComponent_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_fulfillmentLocationId_fkey" FOREIGN KEY ("fulfillmentLocationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoastBatch" ADD CONSTRAINT "RoastBatch_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoastBatch" ADD CONSTRAINT "RoastBatch_stockDocumentId_fkey" FOREIGN KEY ("stockDocumentId") REFERENCES "StockDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocationAccess" ADD CONSTRAINT "UserLocationAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocationAccess" ADD CONSTRAINT "UserLocationAccess_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLocationPolicy" ADD CONSTRAINT "InventoryLocationPolicy_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLocationPolicy" ADD CONSTRAINT "InventoryLocationPolicy_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryVariancePolicy" ADD CONSTRAINT "InventoryVariancePolicy_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_parentDocumentId_fkey" FOREIGN KEY ("parentDocumentId") REFERENCES "StockDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "StockDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCostLayer" ADD CONSTRAINT "InventoryCostLayer_stockDocumentId_fkey" FOREIGN KEY ("stockDocumentId") REFERENCES "StockDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_stockDocumentId_fkey" FOREIGN KEY ("stockDocumentId") REFERENCES "StockDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_costLayerId_fkey" FOREIGN KEY ("costLayerId") REFERENCES "InventoryCostLayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingBatch" ADD CONSTRAINT "PackingBatch_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingBatch" ADD CONSTRAINT "PackingBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingBatch" ADD CONSTRAINT "PackingBatch_outputInventoryItemId_fkey" FOREIGN KEY ("outputInventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingBatch" ADD CONSTRAINT "PackingBatch_recipeVersionId_fkey" FOREIGN KEY ("recipeVersionId") REFERENCES "ProductRecipeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingBatch" ADD CONSTRAINT "PackingBatch_stockDocumentId_fkey" FOREIGN KEY ("stockDocumentId") REFERENCES "StockDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingBatch" ADD CONSTRAINT "PackingBatch_outputLotId_fkey" FOREIGN KEY ("outputLotId") REFERENCES "InventoryCostLayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingBatch" ADD CONSTRAINT "PackingBatch_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingBatchComponent" ADD CONSTRAINT "PackingBatchComponent_packingBatchId_fkey" FOREIGN KEY ("packingBatchId") REFERENCES "PackingBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingBatchComponent" ADD CONSTRAINT "PackingBatchComponent_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingBatchComponent" ADD CONSTRAINT "PackingBatchComponent_costLayerId_fkey" FOREIGN KEY ("costLayerId") REFERENCES "InventoryCostLayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_stockDocumentId_fkey" FOREIGN KEY ("stockDocumentId") REFERENCES "StockDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountLine" ADD CONSTRAINT "InventoryCountLine_inventoryCountId_fkey" FOREIGN KEY ("inventoryCountId") REFERENCES "InventoryCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountLine" ADD CONSTRAINT "InventoryCountLine_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReplenishmentRequest" ADD CONSTRAINT "StockReplenishmentRequest_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReplenishmentRequest" ADD CONSTRAINT "StockReplenishmentRequest_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReplenishmentRequest" ADD CONSTRAINT "StockReplenishmentRequest_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReplenishmentRequest" ADD CONSTRAINT "StockReplenishmentRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReplenishmentRequest" ADD CONSTRAINT "StockReplenishmentRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReplenishmentRequest" ADD CONSTRAINT "StockReplenishmentRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDiscrepancy" ADD CONSTRAINT "StockDiscrepancy_stockDocumentId_fkey" FOREIGN KEY ("stockDocumentId") REFERENCES "StockDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDiscrepancy" ADD CONSTRAINT "StockDiscrepancy_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDiscrepancy" ADD CONSTRAINT "StockDiscrepancy_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDiscrepancy" ADD CONSTRAINT "StockDiscrepancy_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDiscrepancy" ADD CONSTRAINT "StockDiscrepancy_resolutionDocumentId_fkey" FOREIGN KEY ("resolutionDocumentId") REFERENCES "StockDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDiscrepancy" ADD CONSTRAINT "StockDiscrepancy_financeEntryId_fkey" FOREIGN KEY ("financeEntryId") REFERENCES "FinanceEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceAccount" ADD CONSTRAINT "FinanceAccount_stockLocationId_fkey" FOREIGN KEY ("stockLocationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_stockLocationId_fkey" FOREIGN KEY ("stockLocationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_inventoryCountId_fkey" FOREIGN KEY ("inventoryCountId") REFERENCES "InventoryCount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "LocationExpensePolicy" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "allowedCategories" "ExpenseCategoryType"[] NOT NULL,
    "maxImmediateAmount" INTEGER NOT NULL DEFAULT 0,
    "receiptRequiredAbove" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationExpensePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalExpenseRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "categoryType" "ExpenseCategoryType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "noReceiptReason" TEXT,
    "status" "LocalExpenseRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "idempotencyKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "reviewIdempotencyKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "financeEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalExpenseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalExpenseAttachment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocalExpenseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocationExpensePolicy_locationId_key" ON "LocationExpensePolicy"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalExpenseRequest_requestNumber_key" ON "LocalExpenseRequest"("requestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LocalExpenseRequest_idempotencyKey_key" ON "LocalExpenseRequest"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LocalExpenseRequest_reviewIdempotencyKey_key" ON "LocalExpenseRequest"("reviewIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LocalExpenseRequest_financeEntryId_key" ON "LocalExpenseRequest"("financeEntryId");

-- CreateIndex
CREATE INDEX "LocalExpenseRequest_locationId_status_date_idx" ON "LocalExpenseRequest"("locationId", "status", "date");

-- CreateIndex
CREATE INDEX "LocalExpenseRequest_accountId_idx" ON "LocalExpenseRequest"("accountId");

-- CreateIndex
CREATE INDEX "LocalExpenseRequest_submittedById_idx" ON "LocalExpenseRequest"("submittedById");

-- CreateIndex
CREATE INDEX "LocalExpenseRequest_reviewedById_idx" ON "LocalExpenseRequest"("reviewedById");

-- CreateIndex
CREATE UNIQUE INDEX "LocalExpenseAttachment_requestId_key" ON "LocalExpenseAttachment"("requestId");

-- CreateIndex
CREATE INDEX "LocalExpenseAttachment_uploadedById_idx" ON "LocalExpenseAttachment"("uploadedById");

-- AddForeignKey
ALTER TABLE "LocationExpensePolicy" ADD CONSTRAINT "LocationExpensePolicy_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalExpenseRequest" ADD CONSTRAINT "LocalExpenseRequest_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalExpenseRequest" ADD CONSTRAINT "LocalExpenseRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalExpenseRequest" ADD CONSTRAINT "LocalExpenseRequest_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalExpenseRequest" ADD CONSTRAINT "LocalExpenseRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalExpenseRequest" ADD CONSTRAINT "LocalExpenseRequest_financeEntryId_fkey" FOREIGN KEY ("financeEntryId") REFERENCES "FinanceEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalExpenseAttachment" ADD CONSTRAINT "LocalExpenseAttachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LocalExpenseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalExpenseAttachment" ADD CONSTRAINT "LocalExpenseAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
