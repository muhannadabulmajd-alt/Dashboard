-- Per-entry IQD conversion: every finance entry is stored in IQD. Foreign-
-- currency payments keep the original amount + rate for the audit trail.

-- 1. Add original-payment audit columns.
ALTER TABLE "FinanceEntry" ADD COLUMN "origCurrency" "Currency";
ALTER TABLE "FinanceEntry" ADD COLUMN "origAmount" INTEGER;
ALTER TABLE "FinanceEntry" ADD COLUMN "fxRate" INTEGER;

-- 2. Convert existing USD entries to IQD at the default rate (1500 IQD per $1),
--    preserving the original USD amount + rate. USD is stored in cents, so
--    IQD = cents / 100 * 1500 = cents * 15 (exact at this rate).
UPDATE "FinanceEntry"
SET "origCurrency" = 'USD',
    "origAmount"   = "amount",
    "fxRate"       = 1500,
    "amount"       = "amount" * 15,
    "currency"     = 'IQD'
WHERE "currency" = 'USD';

-- 3. Convert any USD accounts (including opening balances) to IQD so the whole
--    system reads in dinars only.
UPDATE "FinanceAccount"
SET "openingBalance" = "openingBalance" * 15,
    "currency"       = 'IQD'
WHERE "currency" = 'USD';
