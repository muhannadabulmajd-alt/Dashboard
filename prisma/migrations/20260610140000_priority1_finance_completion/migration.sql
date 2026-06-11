-- Priority 1 finance completion: richer parties/accounts, branch-tagged
-- ledger entries, attachment references, and reversal metadata.

ALTER TYPE "PartyType" ADD VALUE IF NOT EXISTS 'DISTRIBUTOR';
ALTER TYPE "PartyType" ADD VALUE IF NOT EXISTS 'SERVICE_PROVIDER';

ALTER TABLE "FinanceAccount" ADD COLUMN "notes" TEXT;

ALTER TABLE "Party"
  ADD COLUMN "address" TEXT,
  ADD COLUMN "branchId" TEXT,
  ADD COLUMN "openingPayable" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "openingReceivable" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "FinanceEntry"
  ADD COLUMN "attachmentUrl" TEXT,
  ADD COLUMN "reversalOfId" TEXT,
  ADD COLUMN "reversedAt" TIMESTAMP(3),
  ADD COLUMN "reversedById" TEXT,
  ADD COLUMN "reversalReason" TEXT;

CREATE INDEX "Party_branchId_idx" ON "Party"("branchId");
CREATE INDEX "FinanceEntry_branchId_idx" ON "FinanceEntry"("branchId");
CREATE INDEX "FinanceEntry_orderId_idx" ON "FinanceEntry"("orderId");
CREATE INDEX "FinanceEntry_createdById_idx" ON "FinanceEntry"("createdById");
CREATE INDEX "FinanceEntry_reversalOfId_idx" ON "FinanceEntry"("reversalOfId");
