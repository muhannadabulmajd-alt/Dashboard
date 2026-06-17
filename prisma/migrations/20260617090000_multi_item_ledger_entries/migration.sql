-- Multi-item ledger entries for vendor invoices, purchases, and mixed expenses.
CREATE TABLE "LedgerEntryLine" (
  "id" TEXT NOT NULL,
  "financeEntryId" TEXT NOT NULL,
  "lineNo" INTEGER NOT NULL,
  "itemType" TEXT NOT NULL DEFAULT 'EXPENSE',
  "itemName" TEXT NOT NULL,
  "categoryType" "ExpenseCategoryType",
  "inventoryItemId" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'unit',
  "quantity" DECIMAL(14,3) NOT NULL,
  "unitCost" DECIMAL(14,3) NOT NULL,
  "discountAmount" INTEGER NOT NULL DEFAULT 0,
  "extraAmount" INTEGER NOT NULL DEFAULT 0,
  "lineTotal" INTEGER NOT NULL,
  "branchId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LedgerEntryLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LedgerEntryLine_financeEntryId_idx" ON "LedgerEntryLine"("financeEntryId");
CREATE INDEX "LedgerEntryLine_inventoryItemId_idx" ON "LedgerEntryLine"("inventoryItemId");
CREATE INDEX "LedgerEntryLine_categoryType_idx" ON "LedgerEntryLine"("categoryType");
CREATE INDEX "LedgerEntryLine_itemType_idx" ON "LedgerEntryLine"("itemType");

ALTER TABLE "LedgerEntryLine"
  ADD CONSTRAINT "LedgerEntryLine_financeEntryId_fkey"
  FOREIGN KEY ("financeEntryId") REFERENCES "FinanceEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LedgerEntryLine"
  ADD CONSTRAINT "LedgerEntryLine_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
