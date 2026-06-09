-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "allowDiscount" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowPriceOverride" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "invoiceName" TEXT,
ADD COLUMN     "minSellingPrice" INTEGER,
ADD COLUMN     "trackInventory" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "variationType" TEXT;

-- CreateTable
CREATE TABLE "ProductPrice" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BASE',
    "channel" "Channel",
    "price" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'IQD',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductPrice_productId_kind_effectiveFrom_idx" ON "ProductPrice"("productId", "kind", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
