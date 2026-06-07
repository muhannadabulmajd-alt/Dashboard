-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "RoastBatch" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;
