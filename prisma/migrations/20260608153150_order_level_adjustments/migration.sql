-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "extraCharges" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "orderDiscount" INTEGER NOT NULL DEFAULT 0;
