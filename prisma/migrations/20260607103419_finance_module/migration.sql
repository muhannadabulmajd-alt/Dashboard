-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH', 'BANK');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('SUPPLIER', 'RETAILER', 'PARTNER', 'CUSTOMER', 'SHAREHOLDER', 'EMPLOYEE', 'OTHER');

-- CreateEnum
CREATE TYPE "FinanceType" AS ENUM ('EXPENSE', 'PURCHASE', 'INCOME', 'PAYMENT_IN', 'PAYMENT_OUT', 'CAPITAL_IN', 'DRAWING', 'TRANSFER');

-- CreateEnum
CREATE TYPE "ObligationKind" AS ENUM ('PAYABLE', 'RECEIVABLE');

-- CreateTable
CREATE TABLE "FinanceAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "bankName" TEXT,
    "branchId" TEXT,
    "currency" "Currency" NOT NULL DEFAULT 'IQD',
    "openingBalance" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PartyType" NOT NULL DEFAULT 'OTHER',
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "equityShare" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceEntry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "FinanceType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'IQD',
    "obligation" BOOLEAN NOT NULL DEFAULT false,
    "obligationKind" "ObligationKind",
    "dueDate" TIMESTAMP(3),
    "accountId" TEXT,
    "toAccountId" TEXT,
    "partyId" TEXT,
    "categoryType" "ExpenseCategoryType",
    "settlesId" TEXT,
    "description" TEXT,
    "reference" TEXT,
    "branchId" TEXT,
    "orderId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceAccount_type_idx" ON "FinanceAccount"("type");

-- CreateIndex
CREATE INDEX "Party_type_idx" ON "Party"("type");

-- CreateIndex
CREATE INDEX "FinanceEntry_date_idx" ON "FinanceEntry"("date");

-- CreateIndex
CREATE INDEX "FinanceEntry_type_idx" ON "FinanceEntry"("type");

-- CreateIndex
CREATE INDEX "FinanceEntry_obligation_idx" ON "FinanceEntry"("obligation");

-- CreateIndex
CREATE INDEX "FinanceEntry_accountId_idx" ON "FinanceEntry"("accountId");

-- CreateIndex
CREATE INDEX "FinanceEntry_partyId_idx" ON "FinanceEntry"("partyId");

-- CreateIndex
CREATE INDEX "FinanceEntry_settlesId_idx" ON "FinanceEntry"("settlesId");

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "FinanceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_settlesId_fkey" FOREIGN KEY ("settlesId") REFERENCES "FinanceEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
