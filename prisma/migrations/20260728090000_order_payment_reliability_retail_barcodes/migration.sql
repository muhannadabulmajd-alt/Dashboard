ALTER TABLE "Product" ADD COLUMN "retailBarcode" TEXT;
ALTER TABLE "Party" ADD COLUMN "collectsOrderPayments" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Party"
SET "collectsOrderPayments" = true
WHERE "externalKey" IN ('HI_EXPRESS', 'WAYL');

WITH numbered AS (
  SELECT
    id,
    row_number() OVER (
      ORDER BY
        CASE
          WHEN "barcodeValue" ~ '^LHB[0-9]+$'
            THEN substring("barcodeValue" FROM 4)::bigint
          ELSE NULL
        END NULLS LAST,
        "createdAt",
        id
    ) AS sequence
  FROM "Product"
),
bodies AS (
  SELECT id, '290' || lpad(sequence::text, 9, '0') AS body
  FROM numbered
),
checks AS (
  SELECT
    id,
    body,
    (
      10 - (
        SELECT sum(
          substring(body FROM pos FOR 1)::integer
          * CASE WHEN pos % 2 = 0 THEN 3 ELSE 1 END
        )
        FROM generate_series(1, 12) AS pos
      ) % 10
    ) % 10 AS check_digit
  FROM bodies
)
UPDATE "Product" AS product
SET "retailBarcode" = checks.body || checks.check_digit::text
FROM checks
WHERE product.id = checks.id;

CREATE OR REPLACE FUNCTION laheeb_valid_ean13(value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  body TEXT;
  total INTEGER := 0;
  idx INTEGER;
  expected INTEGER;
BEGIN
  IF value !~ '^290[0-9]{10}$' THEN
    RETURN false;
  END IF;
  body := substring(value FROM 1 FOR 12);
  FOR idx IN 1..12 LOOP
    total := total
      + substring(body FROM idx FOR 1)::integer
      * CASE WHEN idx % 2 = 0 THEN 3 ELSE 1 END;
  END LOOP;
  expected := (10 - (total % 10)) % 10;
  RETURN expected = substring(value FROM 13 FOR 1)::integer;
END;
$$;

ALTER TABLE "Product"
  ALTER COLUMN "retailBarcode" SET NOT NULL;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_retailBarcode_ean13_check"
  CHECK (laheeb_valid_ean13("retailBarcode"));

CREATE UNIQUE INDEX "Product_retailBarcode_key"
  ON "Product"("retailBarcode");
