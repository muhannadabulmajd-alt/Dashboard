-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Governorate" ADD VALUE 'WASIT';
ALTER TYPE "Governorate" ADD VALUE 'DIYALA';
ALTER TYPE "Governorate" ADD VALUE 'DHI_QAR';
ALTER TYPE "Governorate" ADD VALUE 'ANBAR';
ALTER TYPE "Governorate" ADD VALUE 'BABYLON';
ALTER TYPE "Governorate" ADD VALUE 'MAYSAN';
ALTER TYPE "Governorate" ADD VALUE 'MUTHANNA';
ALTER TYPE "Governorate" ADD VALUE 'DIWANIYAH';
ALTER TYPE "Governorate" ADD VALUE 'SALAHUDDIN';
ALTER TYPE "Governorate" ADD VALUE 'HALABJA';
