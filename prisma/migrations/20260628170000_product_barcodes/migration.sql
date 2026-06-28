ALTER TABLE "Product" ADD COLUMN "barcodeValue" TEXT;

WITH numbered AS (
  SELECT
    "id",
    row_number() OVER (ORDER BY "sku" ASC, "id" ASC) AS rn
  FROM "Product"
)
UPDATE "Product"
SET "barcodeValue" = 'LHB' || lpad(numbered.rn::text, 6, '0')
FROM numbered
WHERE "Product"."id" = numbered."id";

ALTER TABLE "Product" ALTER COLUMN "barcodeValue" SET NOT NULL;

CREATE UNIQUE INDEX "Product_barcodeValue_key" ON "Product"("barcodeValue");
