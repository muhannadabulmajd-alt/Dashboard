CREATE TYPE "ProviderFeeMode" AS ENUM ('NONE', 'PERCENT_PLUS_FIXED', 'ORDER_DELIVERY_COST');
CREATE TYPE "FinanceCostRole" AS ENUM ('OPERATING', 'DIRECT_DELIVERY', 'PAYMENT_PROCESSING');

ALTER TABLE "Party"
  ADD COLUMN "automaticOrderSettlement" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "providerFeeMode" "ProviderFeeMode" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "feeRateBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "fixedFee" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "FinanceEntry" ADD COLUMN "costRole" "FinanceCostRole";
CREATE INDEX "FinanceEntry_costRole_idx" ON "FinanceEntry"("costRole");
ALTER TABLE "Party"
  ADD CONSTRAINT "Party_provider_fee_values_check"
  CHECK ("feeRateBps" BETWEEN 0 AND 10000 AND "fixedFee" >= 0);

UPDATE "Party"
SET
  "automaticOrderSettlement" = true,
  "providerFeeMode" = 'ORDER_DELIVERY_COST',
  "feeRateBps" = 0,
  "fixedFee" = 0,
  "netFeesFromRemittance" = true,
  "defaultSettlementAccountId" = (
    SELECT id FROM "FinanceAccount" WHERE "externalKey" = 'CASH_ON_HANDS'
  )
WHERE "externalKey" = 'HI_EXPRESS';

UPDATE "Party"
SET
  "automaticOrderSettlement" = true,
  "providerFeeMode" = 'PERCENT_PLUS_FIXED',
  "feeRateBps" = 350,
  "fixedFee" = 600,
  "netFeesFromRemittance" = true,
  "defaultSettlementAccountId" = (
    SELECT id FROM "FinanceAccount" WHERE "externalKey" = 'FIB'
  )
WHERE "externalKey" = 'WAYL';

UPDATE "FinanceEntry"
SET "costRole" = 'DIRECT_DELIVERY'
WHERE
  "orderId" IS NOT NULL
  AND "categoryType" = 'SHIPPING'
  AND type IN ('EXPENSE', 'PURCHASE')
  AND "costRole" IS NULL;

INSERT INTO "Setting" ("key", "value", "updatedAt")
VALUES (
  'simplified_finance_reconciliation_cutoff',
  CURRENT_TIMESTAMP::text,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE
SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP;

SELECT 1 / CASE
  WHEN NOT EXISTS (
    SELECT 1
    FROM "Order"
    WHERE "createdAt" <= (
      SELECT value::timestamptz
      FROM "Setting"
      WHERE "key" = 'simplified_finance_reconciliation_cutoff'
    )
  ) THEN 1
  WHEN NOT EXISTS (
    SELECT 1
    FROM "Order"
    WHERE
      "createdAt" <= (
        SELECT value::timestamptz
        FROM "Setting"
        WHERE "key" = 'simplified_finance_reconciliation_cutoff'
      )
      AND "grossAmount" - "discountAmount" - "refundAmount"
        + "deliveryFee" + "extraCharges" < 0
  )
  AND EXISTS (
    SELECT 1
    FROM "FinanceAccount"
    WHERE "externalKey" = 'CASH_ON_HANDS' AND "isActive" = true
  )
  AND EXISTS (
    SELECT 1
    FROM "FinanceAccount"
    WHERE "externalKey" = 'FIB' AND "isActive" = true
  )
  AND EXISTS (
    SELECT 1
    FROM "Party"
    WHERE "externalKey" = 'HI_EXPRESS'
      AND "isActive" = true
      AND "automaticOrderSettlement" = true
      AND "defaultSettlementAccountId" IS NOT NULL
  )
  AND EXISTS (
    SELECT 1
    FROM "Party"
    WHERE "externalKey" = 'WAYL'
      AND "isActive" = true
      AND "automaticOrderSettlement" = true
      AND "defaultSettlementAccountId" IS NOT NULL
  ) THEN 1
  ELSE 0
END AS simplified_finance_preflight;

UPDATE "LedgerEntryLine"
SET
  "itemType" = 'ASSET',
  "categoryType" = 'EQUIPMENT',
  "assetCategory" = 'Brand identity',
  notes = concat_ws(
    E'\n',
    nullif(notes, ''),
    'Reclassified from Marketing/Opex to Brand identity/Capex by owner instruction on 2026-07-28.'
  )
WHERE "financeEntryId" IN (
  SELECT id FROM "FinanceEntry" WHERE "recordKey" = 'DOC000169'
);

UPDATE "FinanceEntry"
SET
  "recordClass" = 'PURCHASE',
  "categoryType" = 'EQUIPMENT',
  description = concat_ws(
    ' — ',
    nullif(description, ''),
    'Brand identity asset'
  )
WHERE "recordKey" = 'DOC000169';

INSERT INTO "FixedAsset" (
  id,
  "importKey",
  name,
  category,
  quantity,
  unit,
  "totalCost",
  "unitCost",
  "purchaseDate",
  "partyId",
  "branchId",
  "financeEntryId",
  notes,
  "isActive",
  "createdById",
  "createdAt",
  "updatedAt"
)
SELECT
  'asset-brand-identity-doc000169',
  'ASSET:DOC000169',
  line."itemName",
  'Brand identity',
  line.quantity,
  line.unit,
  line."lineTotal",
  line."landedUnitCost",
  entry.date,
  entry."partyId",
  coalesce(line."branchId", entry."branchId"),
  entry.id,
  'Reclassified from Marketing/Opex by owner instruction. Historical cash amount is unchanged.',
  true,
  entry."createdById",
  entry."createdAt",
  CURRENT_TIMESTAMP
FROM "FinanceEntry" entry
JOIN "LedgerEntryLine" line ON line."financeEntryId" = entry.id
WHERE entry."recordKey" = 'DOC000169'
ORDER BY line."lineNo"
LIMIT 1
ON CONFLICT ("importKey") DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  quantity = EXCLUDED.quantity,
  unit = EXCLUDED.unit,
  "totalCost" = EXCLUDED."totalCost",
  "unitCost" = EXCLUDED."unitCost",
  "purchaseDate" = EXCLUDED."purchaseDate",
  "partyId" = EXCLUDED."partyId",
  "branchId" = EXCLUDED."branchId",
  "financeEntryId" = EXCLUDED."financeEntryId",
  notes = EXCLUDED.notes,
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", metadata)
SELECT
  'audit-reclassify-doc000169-20260728',
  owner_user.id,
  'RECLASSIFY_FINANCE_ENTRY',
  'FinanceEntry',
  entry.id,
  jsonb_build_object(
    'recordKey', 'DOC000169',
    'before', jsonb_build_object('treatment', 'OPEX', 'category', 'MARKETING'),
    'after', jsonb_build_object('treatment', 'CAPEX', 'category', 'Brand identity'),
    'amount', 1500000,
    'cashChanged', false,
    'reason', 'Owner-directed correction'
  )
FROM "FinanceEntry" entry
CROSS JOIN LATERAL (
  SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1
) owner_user
WHERE entry."recordKey" = 'DOC000169'
ON CONFLICT (id) DO NOTHING;

WITH canceled_order AS (
  SELECT
    orders.id,
    greatest(
      orders."grossAmount" - orders."discountAmount" - orders."refundAmount"
        + orders."deliveryFee" + orders."extraCharges",
      0
    )::integer AS invoice_total
  FROM "Order" orders
  WHERE orders.id = 'cmraeruxr000jl10445ql9ox7'
),
customer_receivable AS (
  SELECT entry.id, entry."partyId", canceled_order.invoice_total
  FROM "FinanceEntry" entry
  JOIN canceled_order ON canceled_order.id = entry."orderId"
  LEFT JOIN "Party" party ON party.id = entry."partyId"
  WHERE
    entry.obligation = true
    AND entry."obligationKind" = 'RECEIVABLE'
    AND coalesce(party."collectsOrderPayments", false) = false
    AND entry."archivedAt" IS NULL
    AND entry."reversedAt" IS NULL
    AND entry."reversalOfId" IS NULL
  ORDER BY entry."createdAt"
  LIMIT 1
)
UPDATE "FinanceEntry" payment
SET amount = customer_receivable.invoice_total
FROM customer_receivable
WHERE
  payment."settlesId" = customer_receivable.id
  AND payment.type = 'PAYMENT_IN'
  AND payment."archivedAt" IS NULL
  AND payment."reversedAt" IS NULL
  AND payment."reversalOfId" IS NULL;

WITH canceled_order AS (
  SELECT
    id,
    greatest(
      "grossAmount" - "discountAmount" - "refundAmount" + "deliveryFee" + "extraCharges",
      0
    )::integer AS invoice_total
  FROM "Order"
  WHERE id = 'cmraeruxr000jl10445ql9ox7'
)
UPDATE "FinanceEntry" entry
SET amount = canceled_order.invoice_total
FROM canceled_order
WHERE
  entry."orderId" = canceled_order.id
  AND entry.obligation = true
  AND entry."obligationKind" = 'RECEIVABLE'
  AND entry."archivedAt" IS NULL
  AND entry."reversedAt" IS NULL
  AND entry."reversalOfId" IS NULL;

INSERT INTO "FinanceEntry" (
  id,
  date,
  type,
  amount,
  currency,
  obligation,
  "accountId",
  "partyId",
  "paymentMethod",
  "importKey",
  description,
  reference,
  "createdById"
)
SELECT
  'customer-credit-cash-20260728',
  (SELECT value::timestamptz FROM "Setting" WHERE "key" = 'simplified_finance_reconciliation_cutoff'),
  'INCOME',
  5000,
  'IQD',
  false,
  account.id,
  receivable."partyId",
  'CASH',
  'RECON:20260728:CUSTOMER:CREDIT:CASH',
  'Cash received above the corrected invoice total and retained as customer credit.',
  orders."orderNumber",
  owner_user.id
FROM "Order" orders
JOIN "FinanceEntry" receivable
  ON receivable."orderId" = orders.id
  AND receivable.obligation = true
  AND receivable."obligationKind" = 'RECEIVABLE'
JOIN "FinanceAccount" account ON account."externalKey" = 'CASH_ON_HANDS'
LEFT JOIN LATERAL (
  SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1
) owner_user ON true
WHERE orders.id = 'cmraeruxr000jl10445ql9ox7'
LIMIT 1
ON CONFLICT ("importKey") DO NOTHING;

INSERT INTO "FinanceEntry" (
  id,
  date,
  type,
  amount,
  currency,
  obligation,
  "obligationKind",
  "dueDate",
  "partyId",
  "importKey",
  description,
  reference,
  "createdById"
)
SELECT
  'customer-credit-payable-20260728',
  (SELECT value::timestamptz FROM "Setting" WHERE "key" = 'simplified_finance_reconciliation_cutoff'),
  'PAYMENT_OUT',
  5000,
  'IQD',
  true,
  'PAYABLE',
  (SELECT value::timestamptz FROM "Setting" WHERE "key" = 'simplified_finance_reconciliation_cutoff'),
  receivable."partyId",
  'RECON:20260728:CUSTOMER:CREDIT:PAYABLE',
  'Customer credit held after correcting an invoice overpayment.',
  orders."orderNumber",
  owner_user.id
FROM "Order" orders
JOIN "FinanceEntry" receivable
  ON receivable."orderId" = orders.id
  AND receivable.obligation = true
  AND receivable."obligationKind" = 'RECEIVABLE'
LEFT JOIN LATERAL (
  SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1
) owner_user ON true
WHERE orders.id = 'cmraeruxr000jl10445ql9ox7'
LIMIT 1
ON CONFLICT ("importKey") DO NOTHING;

WITH active_finance AS (
  SELECT *
  FROM "FinanceEntry"
  WHERE "archivedAt" IS NULL AND "reversedAt" IS NULL AND "reversalOfId" IS NULL
),
open_receivables AS (
  SELECT
    receivable.id,
    receivable."orderId",
    receivable."branchId",
    receivable."partyId" AS customer_party_id,
    receivable.amount - coalesce(sum(payment.amount), 0)::integer AS outstanding
  FROM active_finance receivable
  LEFT JOIN active_finance payment ON payment."settlesId" = receivable.id
  JOIN "Order" orders ON orders.id = receivable."orderId"
  WHERE
    orders."createdAt" <= (
      SELECT value::timestamptz
      FROM "Setting"
      WHERE "key" = 'simplified_finance_reconciliation_cutoff'
    )
    AND receivable.obligation = true
    AND receivable."obligationKind" = 'RECEIVABLE'
  GROUP BY receivable.id, receivable."orderId", receivable."branchId", receivable."partyId", receivable.amount
  HAVING receivable.amount - coalesce(sum(payment.amount), 0) > 0
),
routed AS (
  SELECT
    open_receivables.*,
    orders.channel,
    orders."fulfillmentMethod",
    CASE
      WHEN orders.channel = 'ONLINE_STORE'
        THEN (SELECT id FROM "Party" WHERE "externalKey" = 'WAYL')
      WHEN orders."fulfillmentMethod" = 'COURIER'
        THEN (SELECT id FROM "Party" WHERE "externalKey" = 'HI_EXPRESS')
      ELSE open_receivables.customer_party_id
    END AS payment_party_id,
    CASE
      WHEN orders.channel = 'ONLINE_STORE'
        THEN (SELECT id FROM "FinanceAccount" WHERE "externalKey" = 'FIB')
      ELSE (SELECT id FROM "FinanceAccount" WHERE "externalKey" = 'CASH_ON_HANDS')
    END AS account_id,
    orders."orderNumber"
  FROM open_receivables
  JOIN "Order" orders ON orders.id = open_receivables."orderId"
)
INSERT INTO "FinanceEntry" (
  id,
  date,
  type,
  amount,
  currency,
  obligation,
  "accountId",
  "partyId",
  "paymentMethod",
  "settlesId",
  "branchId",
  "orderId",
  "importKey",
  description,
  reference,
  "createdById"
)
SELECT
  'simplified-order-pay-' || md5(routed.id),
  (SELECT value::timestamptz FROM "Setting" WHERE "key" = 'simplified_finance_reconciliation_cutoff'),
  'PAYMENT_IN',
  routed.outstanding,
  'IQD',
  false,
  routed.account_id,
  routed.payment_party_id,
  CASE WHEN routed.channel = 'ONLINE_STORE' THEN 'ONLINE_PAYMENT' ELSE 'COURIER_COLLECTION' END,
  routed.id,
  routed."branchId",
  routed."orderId",
  'RECON:20260728:ORDER:' || routed."orderId",
  'Owner-directed completion and payment reconciliation.',
  routed."orderNumber",
  owner_user.id
FROM routed
LEFT JOIN LATERAL (
  SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1
) owner_user ON true
ON CONFLICT ("importKey") DO NOTHING;

WITH active_finance AS (
  SELECT *
  FROM "FinanceEntry"
  WHERE "archivedAt" IS NULL AND "reversedAt" IS NULL AND "reversalOfId" IS NULL
),
payment_facts AS (
  SELECT
    orders.id,
    orders."orderNumber",
    orders."placedAt",
    orders."branchId",
    orders.channel,
    orders."fulfillmentMethod",
    greatest(
      orders."grossAmount" - orders."discountAmount" - orders."refundAmount"
        + orders."deliveryFee" + orders."extraCharges",
      0
    )::bigint AS invoice_total,
    coalesce((
      SELECT sum(entry.amount)
      FROM active_finance entry
      WHERE
        entry."orderId" = orders.id
        AND entry.type = 'INCOME'
        AND entry.obligation = false
        AND entry."settlesId" IS NULL
    ), 0)::bigint
    + coalesce((
      SELECT sum(payment.amount)
      FROM active_finance payment
      JOIN active_finance base ON base.id = payment."settlesId"
      LEFT JOIN "Party" party ON party.id = base."partyId"
      WHERE
        base."orderId" = orders.id
        AND payment.type = 'PAYMENT_IN'
        AND coalesce(party."collectsOrderPayments", false) = false
    ), 0)::bigint
    + coalesce((
      SELECT sum(base.amount)
      FROM active_finance base
      JOIN "Party" party ON party.id = base."partyId"
      WHERE
        base."orderId" = orders.id
        AND base.obligation = true
        AND base."obligationKind" = 'RECEIVABLE'
        AND party."collectsOrderPayments" = true
    ), 0)::bigint AS paid_total
  FROM "Order" orders
  WHERE orders."createdAt" <= (
    SELECT value::timestamptz
    FROM "Setting"
    WHERE "key" = 'simplified_finance_reconciliation_cutoff'
  )
),
gaps AS (
  SELECT
    payment_facts.*,
    (invoice_total - paid_total)::integer AS outstanding,
    CASE
      WHEN channel = 'ONLINE_STORE'
        THEN (SELECT id FROM "Party" WHERE "externalKey" = 'WAYL')
      WHEN "fulfillmentMethod" = 'COURIER'
        THEN (SELECT id FROM "Party" WHERE "externalKey" = 'HI_EXPRESS')
      ELSE NULL
    END AS payment_party_id,
    CASE
      WHEN channel = 'ONLINE_STORE'
        THEN (SELECT id FROM "FinanceAccount" WHERE "externalKey" = 'FIB')
      ELSE (SELECT id FROM "FinanceAccount" WHERE "externalKey" = 'CASH_ON_HANDS')
    END AS account_id
  FROM payment_facts
  WHERE invoice_total > paid_total
)
INSERT INTO "FinanceEntry" (
  id,
  date,
  type,
  amount,
  currency,
  obligation,
  "accountId",
  "partyId",
  "paymentMethod",
  "branchId",
  "orderId",
  "importKey",
  description,
  reference,
  "createdById"
)
SELECT
  'simplified-order-balance-' || md5(gaps.id),
  (SELECT value::timestamptz FROM "Setting" WHERE "key" = 'simplified_finance_reconciliation_cutoff'),
  'INCOME',
  gaps.outstanding,
  'IQD',
  false,
  gaps.account_id,
  gaps.payment_party_id,
  CASE
    WHEN gaps.channel = 'ONLINE_STORE' THEN 'ONLINE_PAYMENT'
    WHEN gaps."fulfillmentMethod" = 'COURIER' THEN 'COURIER_COLLECTION'
    ELSE 'CASH'
  END,
  gaps."branchId",
  gaps.id,
  'RECON:20260728:ORDER:BALANCE:' || gaps.id,
  'Owner-directed completion and payment reconciliation.',
  gaps."orderNumber",
  owner_user.id
FROM gaps
LEFT JOIN LATERAL (
  SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1
) owner_user ON true
ON CONFLICT ("importKey") DO NOTHING;

INSERT INTO "FinanceEntry" (
  id,
  date,
  type,
  amount,
  currency,
  obligation,
  "accountId",
  "partyId",
  "categoryType",
  "costRole",
  "paymentMethod",
  "branchId",
  "orderId",
  "importKey",
  description,
  reference,
  "createdById"
)
SELECT
  'simplified-delivery-fee-' || md5(orders.id),
  orders."placedAt",
  'EXPENSE',
  orders."deliveryCost",
  'IQD',
  false,
  account.id,
  provider.id,
  'SHIPPING',
  'DIRECT_DELIVERY',
  'COURIER_COLLECTION',
  orders."branchId",
  orders.id,
  'RECON:20260728:DELIVERY:' || orders.id,
  'Courier fee deducted automatically from the collected order amount.',
  orders."orderNumber",
  owner_user.id
FROM "Order" orders
JOIN "FinanceAccount" account ON account."externalKey" = 'CASH_ON_HANDS'
JOIN "Party" provider ON provider."externalKey" = 'HI_EXPRESS'
LEFT JOIN LATERAL (
  SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1
) owner_user ON true
WHERE
  orders."createdAt" <= (
    SELECT value::timestamptz
    FROM "Setting"
    WHERE "key" = 'simplified_finance_reconciliation_cutoff'
  )
  AND orders.status <> 'COMPLETED'
  AND orders."fulfillmentMethod" = 'COURIER'
  AND orders."deliveryCost" > 0
  AND NOT EXISTS (
    SELECT 1
    FROM "FinanceEntry" existing
    WHERE
      existing."orderId" = orders.id
      AND existing."categoryType" = 'SHIPPING'
      AND existing.type IN ('EXPENSE', 'PURCHASE')
      AND existing."archivedAt" IS NULL
      AND existing."reversedAt" IS NULL
      AND existing."reversalOfId" IS NULL
  )
ON CONFLICT ("importKey") DO NOTHING;

INSERT INTO "FinanceEntry" (
  id,
  date,
  type,
  amount,
  currency,
  obligation,
  "accountId",
  "partyId",
  "categoryType",
  "costRole",
  "paymentMethod",
  "branchId",
  "orderId",
  "importKey",
  description,
  reference,
  "createdById"
)
SELECT
  'simplified-wayl-fee-' || md5(orders.id),
  orders."placedAt",
  'EXPENSE',
  least(
    greatest(
      orders."grossAmount" - orders."discountAmount" - orders."refundAmount"
        + orders."deliveryFee" + orders."extraCharges",
      0
    ),
    round(
      greatest(
        orders."grossAmount" - orders."discountAmount" - orders."refundAmount"
          + orders."deliveryFee" + orders."extraCharges",
        0
      ) * 350 / 10000.0
    )::integer + 600
  ),
  'IQD',
  false,
  account.id,
  provider.id,
  'TECH',
  'PAYMENT_PROCESSING',
  'ONLINE_PAYMENT',
  orders."branchId",
  orders.id,
  'RECON:20260728:WAYL:FEE:' || orders.id,
  'Wayl fee deducted automatically from the collected order amount.',
  orders."orderNumber",
  owner_user.id
FROM "Order" orders
JOIN "FinanceAccount" account ON account."externalKey" = 'FIB'
JOIN "Party" provider ON provider."externalKey" = 'WAYL'
LEFT JOIN LATERAL (
  SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1
) owner_user ON true
WHERE
  orders."createdAt" <= (
    SELECT value::timestamptz
    FROM "Setting"
    WHERE "key" = 'simplified_finance_reconciliation_cutoff'
  )
  AND orders.status <> 'COMPLETED'
  AND orders.channel = 'ONLINE_STORE'
  AND greatest(
    orders."grossAmount" - orders."discountAmount" - orders."refundAmount"
      + orders."deliveryFee" + orders."extraCharges",
    0
  ) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM "FinanceEntry" existing
    WHERE
      existing."orderId" = orders.id
      AND existing."costRole" = 'PAYMENT_PROCESSING'
      AND existing."archivedAt" IS NULL
      AND existing."reversedAt" IS NULL
      AND existing."reversalOfId" IS NULL
  )
ON CONFLICT ("importKey") DO NOTHING;

WITH wallet_commission(order_code, amount) AS (
  VALUES
    ('1A52C792', 1720),
    ('998C8C52', 1282),
    ('E3FCD7DA', 1370),
    ('EB5369GD', 1282),
    ('I9D0FC09', 1370),
    ('I56H8BB5', 1282),
    ('G8G9AHEI', 1247)
),
matched AS (
  SELECT DISTINCT ON (wallet_commission.order_code)
    wallet_commission.order_code,
    wallet_commission.amount,
    orders.id,
    orders."orderNumber",
    orders."placedAt",
    orders."branchId"
  FROM wallet_commission
  JOIN "Order" orders ON coalesce(orders.notes, '') ILIKE '%' || wallet_commission.order_code || '%'
  ORDER BY wallet_commission.order_code, orders."createdAt", orders.id
)
INSERT INTO "FinanceEntry" (
  id,
  date,
  type,
  amount,
  currency,
  obligation,
  "accountId",
  "partyId",
  "categoryType",
  "costRole",
  "paymentMethod",
  "branchId",
  "orderId",
  "importKey",
  description,
  reference,
  "createdById"
)
SELECT
  'wayl-wallet-fee-' || lower(matched.order_code),
  matched."placedAt",
  'EXPENSE',
  matched.amount,
  'IQD',
  false,
  account.id,
  provider.id,
  'TECH',
  'PAYMENT_PROCESSING',
  'ONLINE_PAYMENT',
  matched."branchId",
  matched.id,
  'WAYL:COMMISSION:' || matched.order_code,
  'Wayl commission imported from wallet-transactions-all-time.csv.',
  matched."orderNumber",
  owner_user.id
FROM matched
JOIN "FinanceAccount" account ON account."externalKey" = 'FIB'
JOIN "Party" provider ON provider."externalKey" = 'WAYL'
LEFT JOIN LATERAL (
  SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1
) owner_user ON true
ON CONFLICT ("importKey") DO NOTHING;

WITH wallet_order(order_code) AS (
  VALUES
    ('1A52C792'),
    ('998C8C52'),
    ('E3FCD7DA'),
    ('EB5369GD'),
    ('I9D0FC09'),
    ('I56H8BB5'),
    ('G8G9AHEI')
),
matched AS (
  SELECT DISTINCT ON (wallet_order.order_code)
    wallet_order.order_code,
    orders.id
  FROM wallet_order
  JOIN "Order" orders ON coalesce(orders.notes, '') ILIKE '%' || wallet_order.order_code || '%'
  ORDER BY wallet_order.order_code, orders."createdAt", orders.id
)
UPDATE "FinanceEntry" receipt
SET
  "accountId" = account.id,
  "partyId" = provider.id,
  "paymentMethod" = 'ONLINE_PAYMENT',
  description = concat_ws(
    ' — ',
    nullif(receipt.description, ''),
    'Verified as Wayl/FIB by wallet-transactions-all-time.csv'
  )
FROM matched
JOIN "FinanceAccount" account ON account."externalKey" = 'FIB'
JOIN "Party" provider ON provider."externalKey" = 'WAYL'
WHERE
  receipt."orderId" = matched.id
  AND receipt.type IN ('INCOME', 'PAYMENT_IN')
  AND receipt.obligation = false
  AND receipt."accountId" IS NOT NULL
  AND receipt."archivedAt" IS NULL
  AND receipt."reversedAt" IS NULL
  AND receipt."reversalOfId" IS NULL;

INSERT INTO "Setting" ("key", "value", "updatedAt")
VALUES (
  'wayl_wallet_unmatched_sales',
  '{"count":5,"grossAmount":122000,"commissionAmount":7269,"orderCodes":["IHID421E","656I8DD3","8D717699","8GIFG6B7","874B6HCI"],"source":"wallet-transactions-all-time.csv","reason":"No matching Atlas order/customer/product lines and not posted to avoid fabricated sales."}',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE
SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "Order"
SET
  status = 'COMPLETED',
  "inventorySyncMode" = CASE
    WHEN status = 'COMPLETED' THEN "inventorySyncMode"
    ELSE 'SKIP_HISTORICAL'
  END
WHERE
  "createdAt" <= (
    SELECT value::timestamptz
    FROM "Setting"
    WHERE "key" = 'simplified_finance_reconciliation_cutoff'
  )
  AND status <> 'COMPLETED';

UPDATE "Customer" customer
SET
  "ordersCount" = stats.order_count,
  "firstOrderAt" = stats.first_order,
  "lastOrderAt" = stats.last_order
FROM (
  SELECT
    customers.id,
    count(orders.id)::integer AS order_count,
    min(orders."placedAt") AS first_order,
    max(orders."placedAt") AS last_order
  FROM "Customer" customers
  LEFT JOIN "Order" orders
    ON orders."customerId" = customers.id
    AND orders.status = 'COMPLETED'
  GROUP BY customers.id
) stats
WHERE customer.id = stats.id;

INSERT INTO "Setting" ("key", "value", "updatedAt")
VALUES (
  'order_payment_invariant_started_at',
  '1970-01-01T00:00:00.000Z',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE
SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "AuditLog" (id, "userId", action, entity, metadata)
SELECT
  'audit-simplified-finance-20260728',
  owner_user.id,
  'SIMPLIFIED_FINANCE_RECONCILIATION',
  'Order',
  jsonb_build_object(
    'cutoff', (
      SELECT value
      FROM "Setting"
      WHERE "key" = 'simplified_finance_reconciliation_cutoff'
    ),
    'ordersInSnapshot', (
      SELECT count(*)
      FROM "Order"
      WHERE "createdAt" <= (
        SELECT value::timestamptz
        FROM "Setting"
        WHERE "key" = 'simplified_finance_reconciliation_cutoff'
      )
    ),
    'ordersCompleted', (
      SELECT count(*)
      FROM "Order"
      WHERE
        "createdAt" <= (
          SELECT value::timestamptz
          FROM "Setting"
          WHERE "key" = 'simplified_finance_reconciliation_cutoff'
        )
        AND status = 'COMPLETED'
    ),
    'openOrderReceivablesAfter', 0,
    'brandingReclassifiedToCapex', 1500000,
    'matchedWaylCommissions', 9553,
    'unmatchedWalletSales', jsonb_build_object('count', 5, 'grossAmount', 122000, 'commissionAmount', 7269),
    'inventoryPolicy', 'SKIP_HISTORICAL for newly completed historical orders'
  )
FROM (
  SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1
) owner_user
ON CONFLICT (id) DO NOTHING;

WITH cutoff AS (
  SELECT value::timestamptz AS value
  FROM "Setting"
  WHERE "key" = 'simplified_finance_reconciliation_cutoff'
),
snapshot_counts AS (
  SELECT
    count(*)::bigint AS total,
    count(*) FILTER (WHERE status = 'COMPLETED')::bigint AS completed
  FROM "Order"
  WHERE "createdAt" <= (SELECT value FROM cutoff)
),
active_finance AS (
  SELECT *
  FROM "FinanceEntry"
  WHERE "archivedAt" IS NULL AND "reversedAt" IS NULL AND "reversalOfId" IS NULL
),
payment_facts AS (
  SELECT
    orders.id,
    greatest(
      orders."grossAmount" - orders."discountAmount" - orders."refundAmount"
        + orders."deliveryFee" + orders."extraCharges",
      0
    )::bigint AS invoice_total,
    coalesce((
      SELECT sum(entry.amount)
      FROM active_finance entry
      WHERE
        entry."orderId" = orders.id
        AND entry.type = 'INCOME'
        AND entry.obligation = false
        AND entry."settlesId" IS NULL
    ), 0)::bigint
    + coalesce((
      SELECT sum(payment.amount)
      FROM active_finance payment
      JOIN active_finance base ON base.id = payment."settlesId"
      LEFT JOIN "Party" party ON party.id = base."partyId"
      WHERE
        base."orderId" = orders.id
        AND payment.type = 'PAYMENT_IN'
        AND coalesce(party."collectsOrderPayments", false) = false
    ), 0)::bigint
    + coalesce((
      SELECT sum(base.amount)
      FROM active_finance base
      JOIN "Party" party ON party.id = base."partyId"
      WHERE
        base."orderId" = orders.id
        AND base.obligation = true
        AND base."obligationKind" = 'RECEIVABLE'
        AND party."collectsOrderPayments" = true
    ), 0)::bigint AS paid_total
  FROM "Order" orders
  WHERE orders."createdAt" <= (SELECT value FROM cutoff)
),
settled AS (
  SELECT "settlesId", sum(amount)::bigint AS amount
  FROM active_finance
  WHERE "settlesId" IS NOT NULL
  GROUP BY "settlesId"
),
open_receivables AS (
  SELECT coalesce(sum(greatest(entry.amount - coalesce(settled.amount, 0), 0)), 0)::bigint AS amount
  FROM active_finance entry
  LEFT JOIN settled ON settled."settlesId" = entry.id
  JOIN "Order" orders ON orders.id = entry."orderId"
  WHERE
    orders."createdAt" <= (SELECT value FROM cutoff)
    AND entry.obligation = true
    AND entry."obligationKind" = 'RECEIVABLE'
)
SELECT 1 / CASE
  WHEN (SELECT total FROM snapshot_counts) = 0 THEN 1
  WHEN
    (SELECT completed = total FROM snapshot_counts)
    AND NOT EXISTS (
      SELECT 1 FROM payment_facts WHERE paid_total <> invoice_total
    )
    AND (SELECT amount FROM open_receivables) = 0
  THEN 1
  ELSE 0
END AS simplified_finance_postflight;
