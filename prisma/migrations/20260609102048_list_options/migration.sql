-- CreateTable
CREATE TABLE "ListOption" (
    "id" TEXT NOT NULL,
    "listKey" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListOption_listKey_isActive_sortOrder_idx" ON "ListOption"("listKey", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ListOption_listKey_code_key" ON "ListOption"("listKey", "code");
