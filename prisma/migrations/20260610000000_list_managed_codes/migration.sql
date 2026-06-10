-- Convert list-managed enum columns to TEXT so Owner/Admin can add new values
-- via System Lists (BRD §9). Hand-written as in-place casts: Prisma's generated
-- migration would DROP + re-ADD each column and erase existing data. Existing
-- values and indexes are preserved; defaults are re-set as text. The old enum
-- types are left in place (unused).

-- Branch.governorate (default BAGHDAD)
ALTER TABLE "Branch" ALTER COLUMN "governorate" DROP DEFAULT;
ALTER TABLE "Branch" ALTER COLUMN "governorate" SET DATA TYPE TEXT USING "governorate"::text;
ALTER TABLE "Branch" ALTER COLUMN "governorate" SET DEFAULT 'BAGHDAD';

-- Customer.governorate (nullable)
ALTER TABLE "Customer" ALTER COLUMN "governorate" SET DATA TYPE TEXT USING "governorate"::text;

-- Order.channel / governorate / status (status default COMPLETED)
ALTER TABLE "Order" ALTER COLUMN "channel" SET DATA TYPE TEXT USING "channel"::text;
ALTER TABLE "Order" ALTER COLUMN "governorate" SET DATA TYPE TEXT USING "governorate"::text;
ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" SET DATA TYPE TEXT USING "status"::text;
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'COMPLETED';

-- Product.grind (default NONE) / roastLevel (nullable)
ALTER TABLE "Product" ALTER COLUMN "grind" DROP DEFAULT;
ALTER TABLE "Product" ALTER COLUMN "grind" SET DATA TYPE TEXT USING "grind"::text;
ALTER TABLE "Product" ALTER COLUMN "grind" SET DEFAULT 'NONE';
ALTER TABLE "Product" ALTER COLUMN "roastLevel" SET DATA TYPE TEXT USING "roastLevel"::text;

-- ProductPrice.channel (nullable)
ALTER TABLE "ProductPrice" ALTER COLUMN "channel" SET DATA TYPE TEXT USING "channel"::text;

-- RoastBatch.roastLevel (nullable)
ALTER TABLE "RoastBatch" ALTER COLUMN "roastLevel" SET DATA TYPE TEXT USING "roastLevel"::text;

-- Shipment.governorate
ALTER TABLE "Shipment" ALTER COLUMN "governorate" SET DATA TYPE TEXT USING "governorate"::text;
