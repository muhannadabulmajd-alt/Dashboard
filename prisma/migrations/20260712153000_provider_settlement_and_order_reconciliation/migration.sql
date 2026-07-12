ALTER TABLE "Party"
  ADD COLUMN "defaultSettlementAccountId" TEXT,
  ADD COLUMN "netFeesFromRemittance" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Party_defaultSettlementAccountId_idx" ON "Party"("defaultSettlementAccountId");

ALTER TABLE "Party"
  ADD CONSTRAINT "Party_defaultSettlementAccountId_fkey"
  FOREIGN KEY ("defaultSettlementAccountId") REFERENCES "FinanceAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProviderSettlement" (
  "id" TEXT NOT NULL,
  "providerPartyId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "grossCleared" INTEGER NOT NULL,
  "feesOffset" INTEGER NOT NULL DEFAULT 0,
  "amountReceived" INTEGER NOT NULL,
  "paymentMethod" TEXT,
  "reference" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderSettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderSettlement_reference_key" ON "ProviderSettlement"("reference");
CREATE INDEX "ProviderSettlement_providerPartyId_date_idx" ON "ProviderSettlement"("providerPartyId", "date");
CREATE INDEX "ProviderSettlement_accountId_idx" ON "ProviderSettlement"("accountId");
CREATE INDEX "ProviderSettlement_createdById_idx" ON "ProviderSettlement"("createdById");

ALTER TABLE "ProviderSettlement"
  ADD CONSTRAINT "ProviderSettlement_providerPartyId_fkey" FOREIGN KEY ("providerPartyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProviderSettlement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProviderSettlement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinanceEntry" ADD COLUMN "providerSettlementId" TEXT;
CREATE INDEX "FinanceEntry_providerSettlementId_idx" ON "FinanceEntry"("providerSettlementId");
ALTER TABLE "FinanceEntry"
  ADD CONSTRAINT "FinanceEntry_providerSettlementId_fkey"
  FOREIGN KEY ("providerSettlementId") REFERENCES "ProviderSettlement"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Party"
SET "defaultSettlementAccountId" = (SELECT id FROM "FinanceAccount" WHERE "externalKey" = 'CASH_ON_HANDS'),
    "netFeesFromRemittance" = true
WHERE "externalKey" = 'HI_EXPRESS';

UPDATE "Party"
SET "defaultSettlementAccountId" = (SELECT id FROM "FinanceAccount" WHERE "externalKey" = 'FIB'),
    "netFeesFromRemittance" = false
WHERE "externalKey" = 'WAYL';

DO $$
DECLARE
  cutoff CONSTANT timestamptz := '2026-07-12 12:21:55.479+00';
  snapshot_orders integer;
  pending_orders integer;
  order_outstanding bigint;
  shipping_outstanding bigint;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status = 'PENDING')
  INTO snapshot_orders, pending_orders
  FROM "Order" WHERE "createdAt" <= cutoff;

  -- Fresh databases run migrations before seed data exists. Configure the
  -- provider schema above, but reserve this correction for the audited live snapshot.
  IF snapshot_orders = 0 THEN
    RETURN;
  END IF;

  WITH active_finance AS (
    SELECT * FROM "FinanceEntry"
    WHERE "archivedAt" IS NULL AND "reversedAt" IS NULL AND "reversalOfId" IS NULL
  ), paid AS (
    SELECT base."orderId", sum(payment.amount)::bigint AS amount
    FROM active_finance payment
    JOIN active_finance base ON base.id = payment."settlesId"
    WHERE payment.type = 'PAYMENT_IN' AND base."orderId" IS NOT NULL
    GROUP BY base."orderId"
  ), direct_paid AS (
    SELECT "orderId", sum(amount)::bigint AS amount
    FROM active_finance
    WHERE type = 'INCOME' AND obligation = false AND "settlesId" IS NULL AND "orderId" IS NOT NULL
    GROUP BY "orderId"
  )
  SELECT sum(greatest(
    (o."grossAmount" - o."discountAmount" - o."refundAmount" + o."deliveryFee" + o."extraCharges")
    - coalesce(paid.amount, 0) - coalesce(direct_paid.amount, 0), 0
  )) INTO order_outstanding
  FROM "Order" o
  LEFT JOIN paid ON paid."orderId" = o.id
  LEFT JOIN direct_paid ON direct_paid."orderId" = o.id
  WHERE o."createdAt" <= cutoff;

  WITH active_finance AS (
    SELECT * FROM "FinanceEntry"
    WHERE "archivedAt" IS NULL AND "reversedAt" IS NULL AND "reversalOfId" IS NULL
  ), settled AS (
    SELECT "settlesId", sum(amount)::bigint amount FROM active_finance
    WHERE "settlesId" IS NOT NULL GROUP BY "settlesId"
  )
  SELECT coalesce(sum(f.amount - coalesce(settled.amount, 0)), 0)
  INTO shipping_outstanding
  FROM active_finance f
  LEFT JOIN settled ON settled."settlesId" = f.id
  WHERE f.obligation = true AND f."obligationKind" = 'PAYABLE' AND f."categoryType" = 'SHIPPING';

  IF snapshot_orders <> 101 OR pending_orders <> 34 OR order_outstanding <> 896500 OR shipping_outstanding <> 280000 THEN
    RAISE EXCEPTION 'Production reconciliation baseline changed: orders %, pending %, order outstanding %, shipping outstanding %', snapshot_orders, pending_orders, order_outstanding, shipping_outstanding;
  END IF;
END $$;

INSERT INTO "ProviderSettlement" ("id", "providerPartyId", "accountId", "date", "grossCleared", "feesOffset", "amountReceived", "paymentMethod", "reference", "createdById")
SELECT 'reconcile-wayl-20260712', p.id, a.id, '2026-07-12 12:21:55.479+00', 222500, 0, 222500, 'BANK_TRANSFER', 'RECON-20260712-WAYL', u.id
FROM "Party" p
JOIN "FinanceAccount" a ON a."externalKey" = 'FIB'
LEFT JOIN LATERAL (SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1) u ON true
WHERE p."externalKey" = 'WAYL' AND EXISTS (SELECT 1 FROM "Order" WHERE "createdAt" <= '2026-07-12 12:21:55.479+00')
ON CONFLICT ("reference") DO NOTHING;

INSERT INTO "ProviderSettlement" ("id", "providerPartyId", "accountId", "date", "grossCleared", "feesOffset", "amountReceived", "paymentMethod", "reference", "createdById")
SELECT 'reconcile-hi-receipts-20260712', p.id, a.id, '2026-07-12 12:21:55.479+00', 352000, 0, 352000, 'CASH', 'RECON-20260712-HI-RECEIPTS', u.id
FROM "Party" p
JOIN "FinanceAccount" a ON a."externalKey" = 'CASH_ON_HANDS'
LEFT JOIN LATERAL (SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1) u ON true
WHERE p."externalKey" = 'HI_EXPRESS' AND EXISTS (SELECT 1 FROM "Order" WHERE "createdAt" <= '2026-07-12 12:21:55.479+00')
ON CONFLICT ("reference") DO NOTHING;

INSERT INTO "ProviderSettlement" ("id", "providerPartyId", "accountId", "date", "grossCleared", "feesOffset", "amountReceived", "paymentMethod", "reference", "createdById")
SELECT 'reconcile-hi-fees-20260712', p.id, a.id, '2026-07-12 12:21:55.479+00', 280000, 280000, 0, 'CASH', 'RECON-20260712-HI-FEES', u.id
FROM "Party" p
JOIN "FinanceAccount" a ON a."externalKey" = 'CASH_ON_HANDS'
LEFT JOIN LATERAL (SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1) u ON true
WHERE p."externalKey" = 'HI_EXPRESS' AND EXISTS (SELECT 1 FROM "Order" WHERE "createdAt" <= '2026-07-12 12:21:55.479+00')
ON CONFLICT ("reference") DO NOTHING;

WITH active_finance AS (
  SELECT * FROM "FinanceEntry"
  WHERE "archivedAt" IS NULL AND "reversedAt" IS NULL AND "reversalOfId" IS NULL
), open_receivables AS (
  SELECT f.id, f."orderId", f."branchId", f.amount - coalesce(sum(s.amount), 0) AS outstanding
  FROM active_finance f
  LEFT JOIN active_finance s ON s."settlesId" = f.id
  JOIN "Order" o ON o.id = f."orderId"
  WHERE f.obligation = true AND f."obligationKind" = 'RECEIVABLE'
    AND o."createdAt" <= '2026-07-12 12:21:55.479+00'
  GROUP BY f.id, f."orderId", f."branchId", f.amount
  HAVING f.amount - coalesce(sum(s.amount), 0) > 0
), routed AS (
  SELECT r.*, o.channel, o."fulfillmentMethod",
    CASE WHEN o.channel = 'ONLINE_STORE' THEN (SELECT id FROM "Party" WHERE "externalKey" = 'WAYL')
         WHEN o."fulfillmentMethod" = 'COURIER' THEN (SELECT id FROM "Party" WHERE "externalKey" = 'HI_EXPRESS')
         ELSE f."partyId" END AS payment_party_id,
    CASE WHEN o.channel = 'ONLINE_STORE' THEN (SELECT id FROM "FinanceAccount" WHERE "externalKey" = 'FIB')
         ELSE (SELECT id FROM "FinanceAccount" WHERE "externalKey" = 'CASH_ON_HANDS') END AS account_id,
    CASE WHEN o.channel = 'ONLINE_STORE' THEN 'reconcile-wayl-20260712'
         WHEN o."fulfillmentMethod" = 'COURIER' THEN 'reconcile-hi-receipts-20260712'
         ELSE NULL END AS provider_settlement_id
  FROM open_receivables r
  JOIN "Order" o ON o.id = r."orderId"
  JOIN "FinanceEntry" f ON f.id = r.id
)
INSERT INTO "FinanceEntry" ("id", "date", type, amount, currency, obligation, "accountId", "partyId", "paymentMethod", "settlesId", "branchId", "orderId", description, reference, "createdById", "providerSettlementId", "importKey")
SELECT 'reconcile-order-' || md5(r.id), '2026-07-12 12:21:55.479+00', 'PAYMENT_IN', r.outstanding, 'IQD', false,
  r.account_id, r.payment_party_id, CASE WHEN r.channel = 'ONLINE_STORE' THEN 'BANK_TRANSFER' ELSE 'CASH' END,
  r.id, r."branchId", r."orderId", 'Owner-directed current order settlement', o."orderNumber", u.id, r.provider_settlement_id,
  'RECON:20260712:ORDER:' || r."orderId"
FROM routed r
JOIN "Order" o ON o.id = r."orderId"
LEFT JOIN LATERAL (SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1) u ON true
ON CONFLICT ("importKey") DO NOTHING;

WITH active_finance AS (
  SELECT * FROM "FinanceEntry"
  WHERE "archivedAt" IS NULL AND "reversedAt" IS NULL AND "reversalOfId" IS NULL
), open_shipping AS (
  SELECT f.id, f."orderId", f."branchId", f."partyId", f.amount - coalesce(sum(s.amount), 0) AS outstanding
  FROM active_finance f LEFT JOIN active_finance s ON s."settlesId" = f.id
  WHERE f.obligation = true AND f."obligationKind" = 'PAYABLE' AND f."categoryType" = 'SHIPPING'
  GROUP BY f.id, f."orderId", f."branchId", f."partyId", f.amount
  HAVING f.amount - coalesce(sum(s.amount), 0) > 0
)
INSERT INTO "FinanceEntry" ("id", "date", type, amount, currency, obligation, "accountId", "partyId", "paymentMethod", "settlesId", "branchId", "orderId", description, "createdById", "providerSettlementId", "importKey")
SELECT 'reconcile-shipping-' || md5(s.id), '2026-07-12 12:21:55.479+00', 'PAYMENT_OUT', s.outstanding, 'IQD', false,
  a.id, s."partyId", 'CASH', s.id, s."branchId", s."orderId", 'Owner-directed historical shipping fee settlement', u.id,
  'reconcile-hi-fees-20260712', 'RECON:20260712:SHIPPING:' || s.id
FROM open_shipping s
JOIN "FinanceAccount" a ON a."externalKey" = 'CASH_ON_HANDS'
LEFT JOIN LATERAL (SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1) u ON true
ON CONFLICT ("importKey") DO NOTHING;

UPDATE "Order"
SET status = 'COMPLETED', "inventorySyncMode" = 'SKIP_HISTORICAL'
WHERE "createdAt" <= '2026-07-12 12:21:55.479+00' AND status = 'PENDING';

UPDATE "Customer" c
SET "ordersCount" = stats.order_count,
    "firstOrderAt" = stats.first_order,
    "lastOrderAt" = stats.last_order
FROM (
  SELECT c2.id, count(o.id)::integer AS order_count, min(o."placedAt") AS first_order, max(o."placedAt") AS last_order
  FROM "Customer" c2 LEFT JOIN "Order" o ON o."customerId" = c2.id AND o.status = 'COMPLETED'
  GROUP BY c2.id
) stats
WHERE c.id = stats.id;

INSERT INTO "AuditLog" (id, "userId", action, entity, metadata)
SELECT 'reconcile-audit-orders-20260712', u.id, 'BULK_RECONCILIATION', 'Order', jsonb_build_object(
  'cutoff', '2026-07-12T12:21:55.479Z', 'orders', 101, 'completed', 101, 'paidTotal', 2335500,
  'waylToFib', 222500, 'hiExpressToCash', 352000, 'directToCash', 322000, 'shippingFeesPaid', 280000,
  'inventoryPolicy', 'SKIP_HISTORICAL'
)
FROM (SELECT id FROM "User" WHERE role = 'OWNER' ORDER BY "createdAt" LIMIT 1) u
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  completed_orders integer;
  open_order_receivables bigint;
  open_shipping_payables bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Order" WHERE "createdAt" <= '2026-07-12 12:21:55.479+00') THEN
    RETURN;
  END IF;
  SELECT count(*) INTO completed_orders FROM "Order"
  WHERE "createdAt" <= '2026-07-12 12:21:55.479+00' AND status = 'COMPLETED';

  WITH active_finance AS (
    SELECT * FROM "FinanceEntry" WHERE "archivedAt" IS NULL AND "reversedAt" IS NULL AND "reversalOfId" IS NULL
  ), settled AS (
    SELECT "settlesId", sum(amount)::bigint amount FROM active_finance WHERE "settlesId" IS NOT NULL GROUP BY "settlesId"
  )
  SELECT coalesce(sum(greatest(f.amount - coalesce(s.amount, 0), 0)), 0) INTO open_order_receivables
  FROM active_finance f LEFT JOIN settled s ON s."settlesId" = f.id JOIN "Order" o ON o.id = f."orderId"
  WHERE f.obligation = true AND f."obligationKind" = 'RECEIVABLE' AND o."createdAt" <= '2026-07-12 12:21:55.479+00';

  WITH active_finance AS (
    SELECT * FROM "FinanceEntry" WHERE "archivedAt" IS NULL AND "reversedAt" IS NULL AND "reversalOfId" IS NULL
  ), settled AS (
    SELECT "settlesId", sum(amount)::bigint amount FROM active_finance WHERE "settlesId" IS NOT NULL GROUP BY "settlesId"
  )
  SELECT coalesce(sum(greatest(f.amount - coalesce(s.amount, 0), 0)), 0) INTO open_shipping_payables
  FROM active_finance f LEFT JOIN settled s ON s."settlesId" = f.id
  WHERE f.obligation = true AND f."obligationKind" = 'PAYABLE' AND f."categoryType" = 'SHIPPING';

  IF completed_orders <> 101 OR open_order_receivables <> 0 OR open_shipping_payables <> 0 THEN
    RAISE EXCEPTION 'Production reconciliation verification failed: completed %, order AR %, shipping AP %', completed_orders, open_order_receivables, open_shipping_payables;
  END IF;
END $$;
