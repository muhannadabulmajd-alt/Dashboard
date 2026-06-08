-- AlterTable
ALTER TABLE "ProductComponent" ADD COLUMN     "inventoryItemId" TEXT;

-- CreateIndex
CREATE INDEX "ProductComponent_inventoryItemId_idx" ON "ProductComponent"("inventoryItemId");

-- AddForeignKey
ALTER TABLE "ProductComponent" ADD CONSTRAINT "ProductComponent_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
