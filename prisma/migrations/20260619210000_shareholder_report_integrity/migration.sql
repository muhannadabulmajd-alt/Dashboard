ALTER TABLE "FinanceEntry" ADD COLUMN "recordKey" TEXT;

-- Preserve the historical source keys already carried by the importer.
UPDATE "FinanceEntry"
SET "recordKey" = COALESCE(
  CASE
    WHEN "importKey" ~ 'DOC[0-9]{6}$' THEN substring("importKey" from '(DOC[0-9]{6})$')
  END,
  CASE
    WHEN reference ~ '^DOC[0-9]{6}$' THEN reference
  END
)
WHERE type IN ('PURCHASE', 'EXPENSE');

CREATE SEQUENCE "finance_spending_record_key_seq";

SELECT setval(
  '"finance_spending_record_key_seq"',
  GREATEST(
    COALESCE((
      SELECT MAX(substring("recordKey" from 4)::integer)
      FROM "FinanceEntry"
      WHERE "recordKey" ~ '^DOC[0-9]{6}$'
    ), 99),
    99
  )
);

CREATE OR REPLACE FUNCTION assign_finance_spending_record_key()
RETURNS trigger AS $$
BEGIN
  IF NEW.type IN ('PURCHASE', 'EXPENSE') AND NEW."recordKey" IS NULL THEN
    NEW."recordKey" := 'DOC' || lpad(nextval('"finance_spending_record_key_seq"')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER finance_spending_record_key_insert
BEFORE INSERT ON "FinanceEntry"
FOR EACH ROW EXECUTE FUNCTION assign_finance_spending_record_key();

-- The only current manual spending entry has no historical DOC key. Allocate
-- the next key using the same database function future inserts use.
UPDATE "FinanceEntry"
SET "recordKey" = 'DOC' || lpad(nextval('"finance_spending_record_key_seq"')::text, 6, '0')
WHERE type IN ('PURCHASE', 'EXPENSE') AND "recordKey" IS NULL;

CREATE UNIQUE INDEX "FinanceEntry_recordKey_key" ON "FinanceEntry"("recordKey");

CREATE OR REPLACE FUNCTION prevent_finance_record_key_change()
RETURNS trigger AS $$
BEGIN
  IF OLD."recordKey" IS DISTINCT FROM NEW."recordKey" THEN
    RAISE EXCEPTION 'FinanceEntry recordKey is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER finance_spending_record_key_immutable
BEFORE UPDATE OF "recordKey" ON "FinanceEntry"
FOR EACH ROW EXECUTE FUNCTION prevent_finance_record_key_change();
