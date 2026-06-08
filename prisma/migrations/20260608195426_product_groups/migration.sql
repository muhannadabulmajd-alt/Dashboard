-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "ProductGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "productLine" "ProductLine" NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductGroup_code_key" ON "ProductGroup"("code");

-- CreateIndex
CREATE INDEX "ProductGroup_isActive_idx" ON "ProductGroup"("isActive");

-- CreateIndex
CREATE INDEX "Product_groupId_idx" ON "Product"("groupId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProductGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
