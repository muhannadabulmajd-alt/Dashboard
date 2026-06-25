-- Add operational channel codes used by the Laheeb order-number format.
INSERT INTO "ListOption" (
  "id", "listKey", "code", "labelEn", "labelAr", "sortOrder",
  "isActive", "isSystem", "createdAt", "updatedAt"
)
VALUES
  ('channel-wa', 'channel', 'WHATSAPP', 'WhatsApp', 'واتساب', 0, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('channel-ig', 'channel', 'INSTAGRAM', 'Instagram', 'انستغرام', 1, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('channel-web', 'channel', 'WEBSITE', 'Website / online store', 'الموقع / المتجر الإلكتروني', 2, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('channel-win', 'channel', 'WALK_IN', 'Walk-in', 'بيع مباشر', 3, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('channel-call', 'channel', 'PHONE', 'Phone call', 'اتصال هاتفي', 4, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('channel-man', 'channel', 'MANUAL', 'Manual internal order', 'طلب داخلي يدوي', 5, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('channel-rsl', 'channel', 'RESELLER', 'Reseller / partner', 'موزع / شريك', 6, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('channel-gft', 'channel', 'GIFT', 'Gift order', 'طلب هدية', 7, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("listKey", "code") DO UPDATE SET
  "labelEn" = EXCLUDED."labelEn",
  "labelAr" = EXCLUDED."labelAr",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = true,
  "isSystem" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

-- Normalize existing order numbers. Existing values are preserved in notes and
-- audit metadata; finance references for order-backed entries follow the new
-- operational order number.
WITH numbered AS (
  SELECT
    o."id",
    o."orderNumber" AS old_number,
    o."notes" AS old_notes,
    o."placedAt",
    o."createdAt",
    CASE
      WHEN upper(o."channel") IN ('WHATSAPP', 'WA', 'SOCIAL') THEN 'WA'
      WHEN upper(o."channel") IN ('INSTAGRAM', 'IG') THEN 'IG'
      WHEN upper(o."channel") IN ('ONLINE_STORE', 'WEBSITE', 'WEB') THEN 'WEB'
      WHEN upper(o."channel") IN ('POS', 'CAFE', 'WALK_IN', 'WALKIN', 'WIN') THEN 'WIN'
      WHEN upper(o."channel") IN ('PHONE', 'PHONE_CALL', 'CALL') THEN 'CALL'
      WHEN upper(o."channel") IN ('MANUAL', 'MANUAL_INTERNAL_ORDER', 'MAN') THEN 'MAN'
      WHEN upper(o."channel") IN ('RESELLERS', 'RESELLER', 'PARTNER', 'RSL') THEN 'RSL'
      WHEN upper(o."channel") IN ('GIFT', 'GFT') THEN 'GFT'
      ELSE COALESCE(NULLIF(regexp_replace(upper(o."channel"), '[^A-Z0-9]', '', 'g'), ''), 'MAN')
    END AS channel_code,
    to_char(o."placedAt", 'YYMMDD') AS date_key,
    row_number() OVER (PARTITION BY to_char(o."placedAt", 'YYMMDD') ORDER BY o."placedAt", o."createdAt", o."id") AS seq
  FROM "Order" o
), final_numbers AS (
  SELECT
    id,
    old_number,
    old_notes,
    'LHB-ORD-' || date_key || '-' || left(channel_code, 4) || '-' || lpad(seq::text, 4, '0') AS new_number
  FROM numbered
), changed AS (
  SELECT *
  FROM final_numbers
  WHERE old_number IS DISTINCT FROM new_number
)
INSERT INTO "AuditLog" ("id", "action", "entity", "entityId", "metadata", "createdAt")
SELECT
  'order-number-backfill-' || md5(id || old_number || new_number),
  'BACKFILL_ORDER_NUMBER',
  'Order',
  id,
  jsonb_build_object('oldOrderNumber', old_number, 'newOrderNumber', new_number, 'source', '20260625090000_laheeb_numbering_and_finance_drilldowns'),
  CURRENT_TIMESTAMP
FROM changed
ON CONFLICT ("id") DO NOTHING;

WITH final_numbers AS (
  SELECT
    o."id",
    o."orderNumber" AS old_number,
    o."notes" AS old_notes,
    'LHB-ORD-' ||
      to_char(o."placedAt", 'YYMMDD') ||
      '-' ||
      left(CASE
        WHEN upper(o."channel") IN ('WHATSAPP', 'WA', 'SOCIAL') THEN 'WA'
        WHEN upper(o."channel") IN ('INSTAGRAM', 'IG') THEN 'IG'
        WHEN upper(o."channel") IN ('ONLINE_STORE', 'WEBSITE', 'WEB') THEN 'WEB'
        WHEN upper(o."channel") IN ('POS', 'CAFE', 'WALK_IN', 'WALKIN', 'WIN') THEN 'WIN'
        WHEN upper(o."channel") IN ('PHONE', 'PHONE_CALL', 'CALL') THEN 'CALL'
        WHEN upper(o."channel") IN ('MANUAL', 'MANUAL_INTERNAL_ORDER', 'MAN') THEN 'MAN'
        WHEN upper(o."channel") IN ('RESELLERS', 'RESELLER', 'PARTNER', 'RSL') THEN 'RSL'
        WHEN upper(o."channel") IN ('GIFT', 'GFT') THEN 'GFT'
        ELSE COALESCE(NULLIF(regexp_replace(upper(o."channel"), '[^A-Z0-9]', '', 'g'), ''), 'MAN')
      END, 4) ||
      '-' ||
      lpad(row_number() OVER (PARTITION BY to_char(o."placedAt", 'YYMMDD') ORDER BY o."placedAt", o."createdAt", o."id")::text, 4, '0') AS new_number
  FROM "Order" o
), changed AS (
  SELECT *
  FROM final_numbers
  WHERE old_number IS DISTINCT FROM new_number
)
UPDATE "Order" o
SET
  "orderNumber" = 'TMP-' || o."id",
  "notes" = CASE
    WHEN c.old_number LIKE 'LHB-ORD-%' THEN o."notes"
    WHEN o."notes" IS NULL OR o."notes" = '' THEN 'Previous order number: ' || c.old_number
    WHEN o."notes" LIKE '%' || 'Previous order number: ' || c.old_number || '%' THEN o."notes"
    ELSE o."notes" || E'\nPrevious order number: ' || c.old_number
  END
FROM changed c
WHERE o."id" = c."id";

WITH final_numbers AS (
  SELECT
    o."id",
    'LHB-ORD-' ||
      to_char(o."placedAt", 'YYMMDD') ||
      '-' ||
      left(CASE
        WHEN upper(o."channel") IN ('WHATSAPP', 'WA', 'SOCIAL') THEN 'WA'
        WHEN upper(o."channel") IN ('INSTAGRAM', 'IG') THEN 'IG'
        WHEN upper(o."channel") IN ('ONLINE_STORE', 'WEBSITE', 'WEB') THEN 'WEB'
        WHEN upper(o."channel") IN ('POS', 'CAFE', 'WALK_IN', 'WALKIN', 'WIN') THEN 'WIN'
        WHEN upper(o."channel") IN ('PHONE', 'PHONE_CALL', 'CALL') THEN 'CALL'
        WHEN upper(o."channel") IN ('MANUAL', 'MANUAL_INTERNAL_ORDER', 'MAN') THEN 'MAN'
        WHEN upper(o."channel") IN ('RESELLERS', 'RESELLER', 'PARTNER', 'RSL') THEN 'RSL'
        WHEN upper(o."channel") IN ('GIFT', 'GFT') THEN 'GFT'
        ELSE COALESCE(NULLIF(regexp_replace(upper(o."channel"), '[^A-Z0-9]', '', 'g'), ''), 'MAN')
      END, 4) ||
      '-' ||
      lpad(row_number() OVER (PARTITION BY to_char(o."placedAt", 'YYMMDD') ORDER BY o."placedAt", o."createdAt", o."id")::text, 4, '0') AS new_number
  FROM "Order" o
)
UPDATE "Order" o
SET "orderNumber" = f.new_number
FROM final_numbers f
WHERE o."id" = f."id";

WITH order_numbers AS (
  SELECT "id", "orderNumber" FROM "Order"
)
UPDATE "FinanceEntry" e
SET
  "reference" = o."orderNumber",
  "description" = CASE
    WHEN e."description" IS NULL THEN e."description"
    ELSE regexp_replace(e."description", '(LHB-O-[0-9]+|LH-O-[0-9]+|ORD-[^ ]+|[A-Z0-9]+-[0-9]+)', o."orderNumber")
  END
FROM order_numbers o
WHERE e."orderId" = o."id"
  AND (e."reference" IS DISTINCT FROM o."orderNumber");

-- Normalize existing customer IDs. Previous IDs remain in notes.
WITH numbered AS (
  SELECT
    c."id",
    c."externalId" AS old_id,
    c."notes" AS old_notes,
    to_char(c."createdAt", 'YYMMDD') AS date_key,
    row_number() OVER (PARTITION BY to_char(c."createdAt", 'YYMMDD') ORDER BY c."createdAt", c."id") AS seq
  FROM "Customer" c
), final_ids AS (
  SELECT
    id,
    old_id,
    old_notes,
    'LHB-CUS-' || date_key || '-' || lpad(seq::text, 4, '0') AS new_id
  FROM numbered
), changed AS (
  SELECT *
  FROM final_ids
  WHERE old_id IS DISTINCT FROM new_id
)
INSERT INTO "AuditLog" ("id", "action", "entity", "entityId", "metadata", "createdAt")
SELECT
  'customer-id-backfill-' || md5(id || COALESCE(old_id, '') || new_id),
  'BACKFILL_CUSTOMER_ID',
  'Customer',
  id,
  jsonb_build_object('oldCustomerId', old_id, 'newCustomerId', new_id, 'source', '20260625090000_laheeb_numbering_and_finance_drilldowns'),
  CURRENT_TIMESTAMP
FROM changed
ON CONFLICT ("id") DO NOTHING;

WITH final_ids AS (
  SELECT
    c."id",
    c."externalId" AS old_id,
    'LHB-CUS-' ||
      to_char(c."createdAt", 'YYMMDD') ||
      '-' ||
      lpad(row_number() OVER (PARTITION BY to_char(c."createdAt", 'YYMMDD') ORDER BY c."createdAt", c."id")::text, 4, '0') AS new_id
  FROM "Customer" c
), changed AS (
  SELECT *
  FROM final_ids
  WHERE old_id IS DISTINCT FROM new_id
)
UPDATE "Customer" c
SET
  "externalId" = 'TMP-' || c."id",
  "notes" = CASE
    WHEN changed.old_id IS NULL OR changed.old_id LIKE 'LHB-CUS-%' THEN c."notes"
    WHEN c."notes" IS NULL OR c."notes" = '' THEN 'Previous customer ID: ' || changed.old_id
    WHEN c."notes" LIKE '%' || 'Previous customer ID: ' || changed.old_id || '%' THEN c."notes"
    ELSE c."notes" || E'\nPrevious customer ID: ' || changed.old_id
  END
FROM changed
WHERE c."id" = changed."id";

WITH final_ids AS (
  SELECT
    c."id",
    'LHB-CUS-' ||
      to_char(c."createdAt", 'YYMMDD') ||
      '-' ||
      lpad(row_number() OVER (PARTITION BY to_char(c."createdAt", 'YYMMDD') ORDER BY c."createdAt", c."id")::text, 4, '0') AS new_id
  FROM "Customer" c
)
UPDATE "Customer" c
SET "externalId" = f.new_id
FROM final_ids f
WHERE c."id" = f."id";
