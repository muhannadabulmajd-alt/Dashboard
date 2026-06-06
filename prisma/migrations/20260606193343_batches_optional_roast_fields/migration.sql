-- AlterTable
ALTER TABLE "RoastBatch" ALTER COLUMN "roastDate" DROP NOT NULL,
ALTER COLUMN "roastLevel" DROP NOT NULL,
ALTER COLUMN "roastedOutputGrams" DROP NOT NULL;
