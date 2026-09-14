-- Persist the exact Inventory V2 command identity so retries can only replay
-- the original actor and payload. Existing rows remain readable but cannot be
-- treated as verified command replays until they carry a hash.

ALTER TABLE "StockDocument" ADD COLUMN "inputHash" TEXT;

ALTER TABLE "StockReservation"
ADD COLUMN "inputHash" TEXT,
ADD COLUMN "createdById" TEXT,
ADD COLUMN "releaseIdempotencyKey" TEXT,
ADD COLUMN "releaseInputHash" TEXT,
ADD COLUMN "releaseReason" TEXT,
ADD COLUMN "releasedById" TEXT;

ALTER TABLE "InventoryCount"
ADD COLUMN "inputHash" TEXT,
ADD COLUMN "reviewInputHash" TEXT;

ALTER TABLE "StockReplenishmentRequest"
ADD COLUMN "inputHash" TEXT,
ADD COLUMN "reviewInputHash" TEXT;

ALTER TABLE "StockDiscrepancy" ADD COLUMN "reviewInputHash" TEXT;

ALTER TABLE "LocalExpenseRequest" ADD COLUMN "reviewInputHash" TEXT;

CREATE UNIQUE INDEX "StockReservation_releaseIdempotencyKey_key"
ON "StockReservation"("releaseIdempotencyKey");
CREATE INDEX "StockReservation_createdById_idx" ON "StockReservation"("createdById");
CREATE INDEX "StockReservation_releasedById_idx" ON "StockReservation"("releasedById");

ALTER TABLE "StockReservation"
ADD CONSTRAINT "StockReservation_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockReservation"
ADD CONSTRAINT "StockReservation_releasedById_fkey"
FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
