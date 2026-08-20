-- Repair order reliability after the 2026-08-13 AI quick-order incident.
-- This migration is idempotent, audited, and a no-op on empty/seed databases.

BEGIN;

SELECT pg_advisory_xact_lock(hashtextextended('laheeb-order-ai-reliability-2026-08-20', 0));

CREATE TEMP TABLE _orders_without_stock_configuration ON COMMIT DROP AS
SELECT DISTINCT order_row.id, order_row.status, order_row."inventorySyncMode"
FROM "Order" order_row
JOIN "OrderLine" line ON line."orderId" = order_row.id
JOIN "Product" product ON product.id = line."productId"
WHERE order_row."inventorySyncMode" = 'NORMAL'
  AND product."trackInventory" = true
  AND NOT EXISTS (
    SELECT 1
    FROM "InventoryItem" item
    WHERE item."productId" = product.id
      AND item."isActive" = true
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "StockMovement" movement
    WHERE movement."orderId" = order_row.id
      AND movement.reason = 'SOLD'
  );

INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", metadata, "createdAt")
SELECT
  'audit-order-stock-mode-' || substr(md5(target.id), 1, 16),
  (SELECT id FROM "User" WHERE role IN ('OWNER', 'ADMIN') ORDER BY "createdAt" LIMIT 1),
  'ORDER_STOCK_SYNC_MODE_REPAIRED',
  'Order',
  target.id,
  jsonb_build_object(
    'before', target."inventorySyncMode",
    'after', 'SKIP_HISTORICAL',
    'status', target.status,
    'reason', 'Sellable products were not connected to inventory; no SOLD movement existed.',
    'migration', '20260820120000_order_ai_reliability_repair'
  ),
  CURRENT_TIMESTAMP
FROM _orders_without_stock_configuration target
ON CONFLICT (id) DO NOTHING;

UPDATE "Order" order_row
SET "inventorySyncMode" = 'SKIP_HISTORICAL'
FROM _orders_without_stock_configuration target
WHERE order_row.id = target.id;

CREATE TEMP TABLE _ai_order_recovery_context ON COMMIT DROP AS
SELECT
  customer.id AS customer_id,
  customer.phone AS customer_phone,
  product.id AS product_id,
  product.sku,
  product."sellUnit" AS sell_unit,
  product."cogsPerUnit" AS cogs_per_unit,
  account.id AS cash_account_id,
  branch.id AS branch_id,
  actor.id AS actor_id,
  (
    SELECT party.id
    FROM "Party" party
    WHERE party.type = 'CUSTOMER'
      AND (
        (customer.phone IS NOT NULL AND party.phone = customer.phone)
        OR party.name IN (customer."nameEn", customer."nameAr")
      )
    ORDER BY party."createdAt"
    LIMIT 1
  ) AS customer_party_id
FROM "Customer" customer
JOIN "Product" product ON product.sku = 'LHB-ESP-ESPSPR-225-WB-MD'
JOIN "FinanceAccount" account ON account."externalKey" = 'CASH_ON_HANDS' AND account."isActive" = true
CROSS JOIN LATERAL (
  SELECT id FROM "Branch" WHERE "isActive" = true ORDER BY "createdAt" LIMIT 1
) branch
CROSS JOIN LATERAL (
  SELECT id FROM "User" WHERE role IN ('OWNER', 'ADMIN') AND "isActive" = true ORDER BY "createdAt" LIMIT 1
) actor
WHERE customer."externalId" = 'LHB-CUS-260619-0036'
  AND customer."isActive" = true
  AND product."isActive" = true;

INSERT INTO "Order" (
  id, "orderNumber", "placedAt", "customerId", "branchId", "createdById",
  channel, governorate, "fulfillmentMethod", status, currency, "grossAmount",
  "discountAmount", "orderDiscount", "extraCharges", "refundAmount",
  "deliveryFee", "deliveryCost", notes, "inventorySyncMode", purpose, "createdAt"
)
SELECT
  'correction-order-ai-260813-wa-0003',
  'LHB-ORD-260813-WA-0003',
  TIMESTAMP '2026-08-13 12:00:00',
  context.customer_id,
  context.branch_id,
  context.actor_id,
  'WHATSAPP',
  'ERBIL',
  'PICKUP',
  'PENDING',
  'IQD',
  27000,
  0,
  0,
  0,
  0,
  0,
  0,
  'Recovered from the confirmed Atlas AI preview on 2026-08-13. The previous assistant displayed success before a database commit.',
  'SKIP_HISTORICAL',
  'SALE',
  TIMESTAMP '2026-08-13 13:57:12'
FROM _ai_order_recovery_context context
WHERE NOT EXISTS (
  SELECT 1 FROM "Order" WHERE id = 'correction-order-ai-260813-wa-0003'
);

INSERT INTO "OrderLine" (
  id, "orderId", "productId", sku, quantity, "unitLabel",
  "unitGrossPrice", "lineDiscount", "lineNet", "unitCogsSnapshot"
)
SELECT
  'correction-line-ai-260813-wa-0003-1',
  'correction-order-ai-260813-wa-0003',
  context.product_id,
  context.sku,
  2,
  context.sell_unit,
  13500,
  0,
  27000,
  context.cogs_per_unit
FROM _ai_order_recovery_context context
WHERE EXISTS (
  SELECT 1 FROM "Order" WHERE id = 'correction-order-ai-260813-wa-0003'
)
ON CONFLICT (id) DO UPDATE SET
  "productId" = EXCLUDED."productId",
  sku = EXCLUDED.sku,
  quantity = EXCLUDED.quantity,
  "unitLabel" = EXCLUDED."unitLabel",
  "unitGrossPrice" = EXCLUDED."unitGrossPrice",
  "lineDiscount" = EXCLUDED."lineDiscount",
  "lineNet" = EXCLUDED."lineNet",
  "unitCogsSnapshot" = EXCLUDED."unitCogsSnapshot";

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "accountId", "partyId",
  "paymentMethod", "importKey", description, reference, "branchId",
  "orderId", "createdById", "createdAt"
)
SELECT
  'correction-payment-ai-260813-wa-0003',
  TIMESTAMP '2026-08-13 12:00:00',
  'INCOME',
  27000,
  'IQD',
  false,
  context.cash_account_id,
  context.customer_party_id,
  'CASH',
  'ORD:correction-order-ai-260813-wa-0003:PAY',
  'Cash received for recovered order LHB-ORD-260813-WA-0003',
  'LHB-ORD-260813-WA-0003',
  context.branch_id,
  'correction-order-ai-260813-wa-0003',
  context.actor_id,
  TIMESTAMP '2026-08-13 13:57:12'
FROM _ai_order_recovery_context context
WHERE EXISTS (
  SELECT 1 FROM "Order" WHERE id = 'correction-order-ai-260813-wa-0003'
)
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount,
  "accountId" = EXCLUDED."accountId",
  "partyId" = EXCLUDED."partyId",
  "paymentMethod" = EXCLUDED."paymentMethod",
  description = EXCLUDED.description,
  reference = EXCLUDED.reference,
  "branchId" = EXCLUDED."branchId",
  "orderId" = EXCLUDED."orderId";

INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", metadata, "createdAt")
SELECT
  'audit-recover-ai-order-260813-0003',
  context.actor_id,
  'ORDER_RECOVERED_FROM_AI_PREVIEW',
  'Order',
  'correction-order-ai-260813-wa-0003',
  jsonb_build_object(
    'orderNumber', 'LHB-ORD-260813-WA-0003',
    'amount', 27000,
    'payment', 'CASH_ON_HANDS',
    'status', 'PENDING',
    'reason', 'Assistant falsely displayed success without a committed pending action.',
    'migration', '20260820120000_order_ai_reliability_repair'
  ),
  CURRENT_TIMESTAMP
FROM _ai_order_recovery_context context
WHERE EXISTS (
  SELECT 1 FROM "Order" WHERE id = 'correction-order-ai-260813-wa-0003'
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM _ai_order_recovery_context) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "Order" order_row
      JOIN "FinanceEntry" payment
        ON payment."orderId" = order_row.id
       AND payment."importKey" = 'ORD:correction-order-ai-260813-wa-0003:PAY'
       AND payment.amount = 27000
       AND payment."archivedAt" IS NULL
       AND payment."reversedAt" IS NULL
      WHERE order_row.id = 'correction-order-ai-260813-wa-0003'
        AND order_row."orderNumber" = 'LHB-ORD-260813-WA-0003'
        AND order_row.status = 'PENDING'
        AND order_row."grossAmount" = 27000
    ) THEN
      RAISE EXCEPTION 'AI order recovery did not reconcile';
    END IF;
  END IF;
END $$;

INSERT INTO "Setting" (key, value, "updatedAt")
VALUES ('order_ai_reliability_repair_version', '2026-08-20-v1', CURRENT_TIMESTAMP)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = CURRENT_TIMESTAMP;

COMMIT;
