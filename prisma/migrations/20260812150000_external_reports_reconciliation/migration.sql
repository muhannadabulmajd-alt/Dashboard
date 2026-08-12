-- Reconcile the approved Wayl, Hi-Express, Prime Express, and Storix reports.
-- The correction is guarded by the audited production-shaped baseline, uses
-- deterministic identifiers, and becomes a no-op on empty/seed databases.

BEGIN;

SELECT pg_advisory_xact_lock(hashtextextended('laheeb-external-reports-reconciliation-2026-08-12', 0));
SET CONSTRAINTS ALL DEFERRED;

DO $$
DECLARE
  required_products integer;
  required_accounts integer;
  required_orders integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Setting"
    WHERE key = 'external_reports_reconciliation_version'
      AND value = '2026-08-12-v1'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "Order" WHERE id = 'correction-order-wayl-688e6c1g') THEN
    RETURN;
  END IF;

  SELECT count(*) INTO required_products
  FROM "Product"
  WHERE sku IN (
    'LHB-ACC-CPS-BSC-5PCS', 'LHB-DRP-BOX10-15G-DB-M',
    'LHB-ESP-ESPSPR-225-MG-MD', 'LHB-ESP-ESPSPR-225-WB-MD',
    'LHB-FLT-DCG-225-FG-M', 'LHB-FLT-DCG-225-WB-M',
    'LHB-TRK-CRD-225-TG-MD', 'LHB-TRK-PLN-225-TG-MD'
  );
  SELECT count(*) INTO required_accounts
  FROM "FinanceAccount"
  WHERE "externalKey" IN ('CASH_ON_HANDS', 'FIB', 'WAYL_WALLET');
  SELECT count(*) INTO required_orders
  FROM "Order"
  WHERE id IN (
    'correction-order-wayl-688e6c1g', 'cms76icut0003ie04utalzcjd',
    'cms7fshaw0004la04inuwb2sf', 'cmsaq6czv0004l304l4q8uz4s',
    'cmqlk9ien007xlg04o2ozfeuu'
  );

  IF required_products <> 8 OR required_accounts <> 3 OR required_orders <> 5 THEN
    RAISE EXCEPTION 'External reconciliation baseline changed: products %, accounts %, targeted orders %',
      required_products, required_accounts, required_orders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Order"
    WHERE id = 'correction-order-wayl-688e6c1g'
      AND status = 'PENDING' AND "grossAmount" = 11000 AND "deliveryFee" = 5000
  ) OR NOT EXISTS (
    SELECT 1 FROM "Order"
    WHERE id = 'cms76icut0003ie04utalzcjd'
      AND status = 'PENDING' AND "grossAmount" = 14500 AND "deliveryFee" = 5000
  ) OR NOT EXISTS (
    SELECT 1 FROM "Order"
    WHERE id = 'cms7fshaw0004la04inuwb2sf'
      AND status = 'PENDING' AND "grossAmount" = 14500 AND "deliveryFee" = 5000
  ) OR NOT EXISTS (
    SELECT 1 FROM "Order"
    WHERE id = 'cmsaq6czv0004l304l4q8uz4s'
      AND status = 'PENDING' AND "grossAmount" = 25500 AND "discountAmount" = 500
  ) THEN
    RAISE EXCEPTION 'A targeted order changed after the external reconciliation review';
  END IF;
END $$;

CREATE TEMP TABLE _external_context ON COMMIT DROP AS
SELECT
  (SELECT id FROM "User" WHERE role IN ('OWNER', 'ADMIN') ORDER BY "createdAt" LIMIT 1) AS actor_id,
  (SELECT id FROM "Branch" WHERE "isActive" ORDER BY "createdAt" LIMIT 1) AS branch_id,
  (SELECT id FROM "FinanceAccount" WHERE "externalKey" = 'CASH_ON_HANDS') AS cash_account_id,
  (SELECT id FROM "FinanceAccount" WHERE "externalKey" = 'FIB') AS fib_account_id,
  (SELECT id FROM "FinanceAccount" WHERE "externalKey" = 'WAYL_WALLET') AS wayl_account_id
WHERE EXISTS (SELECT 1 FROM "Order" WHERE id = 'correction-order-wayl-688e6c1g')
  AND NOT EXISTS (
    SELECT 1 FROM "Setting"
    WHERE key = 'external_reports_reconciliation_version'
      AND value = '2026-08-12-v1'
  );

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _external_context) THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM _external_context
    WHERE actor_id IS NULL OR branch_id IS NULL OR cash_account_id IS NULL
      OR fib_account_id IS NULL OR wayl_account_id IS NULL
  ) THEN
    RAISE EXCEPTION 'External reconciliation context is incomplete';
  END IF;
END $$;

INSERT INTO "Party" (
  id, "externalKey", name, type, notes, "defaultSettlementAccountId",
  "netFeesFromRemittance", "collectsOrderPayments", "automaticOrderSettlement",
  "providerFeeMode", "feeRateBps", "fixedFee", "isActive", "createdAt"
)
SELECT
  'party-storix', 'STORIX', 'Storix', 'SERVICE_PROVIDER',
  'Fulfillment provider. Customer collections remain receivable until Storix remits the net deposit.',
  context.cash_account_id, true, true, false, 'ORDER_DELIVERY_COST', 0, 0, true,
  CURRENT_TIMESTAMP
FROM _external_context context
ON CONFLICT ("externalKey") DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  notes = EXCLUDED.notes,
  "defaultSettlementAccountId" = EXCLUDED."defaultSettlementAccountId",
  "netFeesFromRemittance" = true,
  "collectsOrderPayments" = true,
  "automaticOrderSettlement" = false,
  "providerFeeMode" = 'ORDER_DELIVERY_COST',
  "feeRateBps" = 0,
  "fixedFee" = 0,
  "isActive" = true;

INSERT INTO "Party" (
  id, "externalKey", name, type, notes, "netFeesFromRemittance",
  "collectsOrderPayments", "automaticOrderSettlement", "providerFeeMode",
  "feeRateBps", "fixedFee", "isActive", "createdAt"
)
SELECT
  'party-prime-express', 'PRIME_EXPRESS', 'Prime Express', 'SERVICE_PROVIDER',
  'Courier evidenced by the approved Prime Express report.', false, false,
  false, 'NONE', 0, 0, true, CURRENT_TIMESTAMP
FROM _external_context
ON CONFLICT ("externalKey") DO UPDATE SET
  name = EXCLUDED.name, type = EXCLUDED.type, notes = EXCLUDED.notes,
  "isActive" = true;

UPDATE "Party"
SET
  type = 'SERVICE_PROVIDER',
  "collectsOrderPayments" = true,
  "automaticOrderSettlement" = false,
  "netFeesFromRemittance" = true,
  "providerFeeMode" = 'ORDER_DELIVERY_COST',
  "defaultSettlementAccountId" = (SELECT cash_account_id FROM _external_context)
WHERE "externalKey" = 'HI_EXPRESS'
  AND EXISTS (SELECT 1 FROM _external_context);

UPDATE "Party"
SET
  type = 'SERVICE_PROVIDER',
  "collectsOrderPayments" = true,
  "automaticOrderSettlement" = false,
  "netFeesFromRemittance" = true,
  "providerFeeMode" = 'PERCENT_PLUS_FIXED',
  "feeRateBps" = 350,
  "fixedFee" = 600,
  "defaultSettlementAccountId" = (SELECT wayl_account_id FROM _external_context)
WHERE "externalKey" = 'WAYL'
  AND EXISTS (SELECT 1 FROM _external_context);

CREATE TEMP TABLE _external_customers (
  customer_key text PRIMARY KEY,
  id text NOT NULL,
  external_id text,
  name_en text,
  name_ar text,
  phone text,
  governorate text,
  address text,
  is_existing boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO _external_customers VALUES
  ('fawz', 'cmqljaykb001plg04kdh8cbrn', NULL, NULL, NULL, NULL, NULL, NULL, true),
  ('saba', 'cmqljawgn001blg04eybjy00h', NULL, 'Saba Al-Bayati', 'صبا البياتي', NULL, NULL, NULL, true),
  ('hamaoy', 'cmqljaus10010lg04uytq2zqk', NULL, NULL, NULL, NULL, NULL, NULL, true),
  ('shahab', 'cmqljb42v002rlg04l36r0ftw', NULL, NULL, NULL, NULL, NULL, NULL, true),
  ('fatima', 'cmqljazaf001ulg04o8uogghu', NULL, NULL, NULL, NULL, NULL, NULL, true),
  ('raghad', 'cmqljb483002slg04b8jwc1h3', NULL, NULL, NULL, NULL, NULL, NULL, true),
  ('aqsa', 'cmqljb4db002tlg04s2z08djy', NULL, NULL, NULL, NULL, NULL, NULL, true),
  ('danya', 'cmqljb4ij002ulg04bmubbygu', NULL, NULL, NULL, NULL, NULL, NULL, true),
  ('laheeb', 'cmqljb4nq002vlg04am1e9sng', NULL, NULL, NULL, NULL, NULL, NULL, true),
  ('hussein', 'ext-customer-hussein', 'LHB-CUS-260812-0101', 'Hussein Abu Al-Maali', 'حسين ابو المعالي', '+9647704408761', 'BAGHDAD', 'Baghdad, Al-Mansour, Emirates Street', false),
  ('mustafa', 'ext-customer-mustafa', 'LHB-CUS-260812-0102', 'Mustafa Al-Aidrous', 'مصطفى العيدروس', '+9647826312790', 'BAGHDAD', 'Baghdad, Al-Sulaikh, Street 600', false),
  ('ghufran', 'ext-customer-ghufran', 'LHB-CUS-260812-0103', 'Ghufran Marsoum', 'غفران مرسوم', '+9647710443300', 'BAGHDAD', NULL, false),
  ('abdullah', 'ext-customer-abdullah', 'LHB-CUS-260812-0104', 'Abdullah Najm', 'عبدالله نجم', '+9647733022020', 'BAGHDAD', NULL, false),
  ('omnia', 'ext-customer-omnia', 'LHB-CUS-260812-0105', 'Omnia', 'امنية', '+9647800501330', 'BASRA', 'Basra, Al-Tanuma, Madinat Al-Narjis', false),
  ('salwa', 'ext-customer-salwa', 'LHB-CUS-260812-0106', 'Salwa Dahham', 'سلوى دحام', '+9647811100140', 'BASRA', 'Basra, Al-Baradhiya', false),
  ('sahar', 'ext-customer-sahar', 'LHB-CUS-260812-0107', 'Sahar Tawfeeq', 'سحر توفيق', '+9647702711274', 'BAGHDAD', NULL, false),
  ('munjed', 'ext-customer-munjed', 'LHB-CUS-260812-0108', 'Munjed Hameed Majeed', 'منجد حميد مجيد', '+9647812121283', 'KARBALA', NULL, false),
  ('zha', 'ext-customer-zha', 'LHB-CUS-260812-0109', 'Zha Ali', 'ژا علي', '+9647808430611', 'BAGHDAD', NULL, false),
  ('ali_dabdab', 'ext-customer-ali-dabdab', 'LHB-CUS-260812-0110', 'Ali Dabdab', 'علي دبدب', '+9647712328090', 'BAGHDAD', NULL, false),
  ('shosha', 'ext-customer-shosha', 'LHB-CUS-260812-0111', 'Shosha Al-Masoudi', 'شوشة المسعودي', '+9647818016851', 'BAGHDAD', 'Baghdad, Al-Karkh, Fifth Transportation, near Kinana School', false),
  ('rasha', 'ext-customer-rasha', 'LHB-CUS-260812-0112', 'Rasha Abdulaziz', 'رشا عبدالعزيز', '+9647700241741', 'BAGHDAD', 'Baghdad, Mathaf Airport Street, Dar Al-Salam complex', false),
  ('wadoud', 'ext-customer-wadoud', 'LHB-CUS-260812-0113', 'Wadoud Al-Azzawi', 'ودود العزاوي', '+9647716768511', 'BAGHDAD', 'Baghdad, Al-Ghazaliya, Umm Salama Street', false),
  ('dhu', 'ext-customer-dhu', 'LHB-CUS-260812-0114', 'Dhulfiqar Fouad', 'ذو الفقار فؤاد', '+9647724417009', 'BAGHDAD', NULL, false),
  ('lubna', 'ext-customer-lubna', 'LHB-CUS-260812-0115', 'Lubna Adnan', 'لبنى عدنان', '+9647723743551', 'BAGHDAD', 'بغداد، عويريج، مقابل كلية ابن خلدون', false),
  ('aseel', 'ext-customer-aseel', 'LHB-CUS-260812-0116', 'Aseel Samer', 'اسيل سامر', '+9647713543444', 'ERBIL', 'أربيل، كلوبال ستي، 2526', false);

INSERT INTO "Customer" (
  id, "externalId", phone, "nameEn", "nameAr", governorate, "address1",
  notes, segment, "isActive", "createdAt"
)
SELECT
  customer.id, customer.external_id, customer.phone, customer.name_en,
  customer.name_ar, customer.governorate, customer.address,
  'Created from approved external report reconciliation on 2026-08-12.',
  'NEW', true, CURRENT_TIMESTAMP
FROM _external_customers customer
CROSS JOIN _external_context
WHERE NOT customer.is_existing
ON CONFLICT (id) DO UPDATE SET
  phone = EXCLUDED.phone,
  "nameEn" = EXCLUDED."nameEn",
  "nameAr" = EXCLUDED."nameAr",
  governorate = EXCLUDED.governorate,
  "address1" = EXCLUDED."address1",
  "isActive" = true;

UPDATE "Customer"
SET "nameEn" = 'Saba Al-Bayati', "nameAr" = 'صبا البياتي'
WHERE id = 'cmqljawgn001blg04eybjy00h'
  AND EXISTS (SELECT 1 FROM _external_context);

CREATE TEMP TABLE _external_orders (
  source_key text PRIMARY KEY,
  id text NOT NULL,
  order_number text NOT NULL,
  placed_at timestamp NOT NULL,
  customer_key text NOT NULL,
  channel text NOT NULL,
  governorate text NOT NULL,
  status text NOT NULL,
  gross_amount integer NOT NULL,
  discount_amount integer NOT NULL,
  delivery_fee integer NOT NULL,
  delivery_cost integer NOT NULL,
  inventory_mode "InventorySyncMode" NOT NULL,
  courier_key text NOT NULL,
  courier_name text NOT NULL,
  shipment_status "ShipmentStatus" NOT NULL,
  tracking text NOT NULL,
  delivered_at timestamp,
  payment_route text NOT NULL,
  notes text NOT NULL
) ON COMMIT DROP;

INSERT INTO _external_orders VALUES
  ('874B6HCI', 'ext-order-wayl-874b6hci', 'LHB-ORD-260622-WEB-0001', '2026-06-22 12:00:00', 'hussein', 'ONLINE_STORE', 'BAGHDAD', 'COMPLETED', 8500, 0, 5000, 5000, 'SKIP_HISTORICAL', 'PRIME_EXPRESS', 'Prime Express', 'DELIVERED', '44513946', '2026-06-22 18:00:00', 'WAYL', 'Wayl 874B6HCI. Prime 44513946. Baghdad, Al-Mansour, Emirates Street.'),
  ('8GIFG6B7', 'ext-order-wayl-8gifg6b7', 'LHB-ORD-260701-WEB-0002', '2026-07-01 12:00:00', 'fawz', 'ONLINE_STORE', 'BAGHDAD', 'COMPLETED', 17000, 0, 5000, 5000, 'SKIP_HISTORICAL', 'PRIME_EXPRESS', 'Prime Express', 'DELIVERED', '45077139', '2026-07-03 18:00:00', 'WAYL', 'Wayl 8GIFG6B7. Prime 45077139. Baghdad, Al-Kadhimiya, Jkok.'),
  ('8D717699', 'ext-order-wayl-8d717699', 'LHB-ORD-260713-WEB-0001', '2026-07-13 12:00:00', 'mustafa', 'ONLINE_STORE', 'BAGHDAD', 'COMPLETED', 23000, 0, 5000, 5000, 'SKIP_HISTORICAL', 'PRIME_EXPRESS', 'Prime Express', 'DELIVERED', '45704448', '2026-07-13 18:00:00', 'WAYL', 'Wayl 8D717699. Prime shipment 45704448; input 152613. Baghdad, Al-Sulaikh, Street 600.'),
  ('656I8DD3', 'ext-order-wayl-656i8dd3', 'LHB-ORD-260728-WEB-0002', '2026-07-28 12:00:00', 'ghufran', 'ONLINE_STORE', 'BAGHDAD', 'COMPLETED', 25500, 0, 5000, 6000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG7231785226047', '2026-07-30 18:00:00', 'WAYL', 'Wayl 656I8DD3. Hi-Express KRG7231785226047.'),
  ('IHID421E', 'ext-order-wayl-ihid421e', 'LHB-ORD-260728-WEB-0003', '2026-07-28 12:05:00', 'saba', 'ONLINE_STORE', 'BAGHDAD', 'COMPLETED', 23000, 0, 5000, 6000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG7631785226167', '2026-07-30 18:00:00', 'WAYL', 'Wayl IHID421E. Hi-Express KRG7631785226167. Correct customer: Saba Al-Bayati.'),
  ('B0BB68G9', 'ext-order-wayl-b0bb68g9', 'LHB-ORD-260801-WEB-0002', '2026-08-01 12:00:00', 'fawz', 'ONLINE_STORE', 'BAGHDAD', 'COMPLETED', 14500, 0, 5000, 6000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG1811785608507', '2026-08-03 18:00:00', 'WAYL', 'Wayl B0BB68G9. Hi-Express KRG1811785608507.'),
  ('D8295I76', 'ext-order-wayl-d8295i76', 'LHB-ORD-260805-WEB-0001', '2026-08-05 12:00:00', 'abdullah', 'ONLINE_STORE', 'BAGHDAD', 'COMPLETED', 8500, 0, 5000, 5000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG7391785939632', '2026-08-07 18:00:00', 'WAYL', 'Wayl D8295I76. Hi-Express KRG7391785939632.'),
  ('BECI8487', 'ext-order-wayl-beci8487', 'LHB-ORD-260807-WEB-0001', '2026-08-07 12:00:00', 'omnia', 'ONLINE_STORE', 'BASRA', 'COMPLETED', 34000, 0, 5000, 5000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG3741786128163', '2026-08-09 18:00:00', 'WAYL', 'Wayl BECI8487. Recipient Omnia. Hi-Express KRG3741786128163.'),
  ('9A817BE0', 'ext-order-wayl-9a817be0', 'LHB-ORD-260807-WEB-0002', '2026-08-07 12:05:00', 'salwa', 'ONLINE_STORE', 'BASRA', 'COMPLETED', 34000, 0, 5000, 5000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG2131786128282', '2026-08-09 18:00:00', 'WAYL', 'Wayl 9A817BE0. Recipient Salwa Dahham. Hi-Express KRG2131786128282.'),
  ('957I7I6E', 'ext-order-storix-957i7i6e', 'LHB-ORD-260809-WEB-0001', '2026-08-09 10:00:00', 'hamaoy', 'ONLINE_STORE', 'BAGHDAD', 'COMPLETED', 22000, 0, 5000, 5000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG5941786303324', '2026-08-10 18:00:00', 'STORIX', 'Customer paid Storix. Hi-Express KRG5941786303324. Storix remittance remains open.'),
  ('31DBIAEA', 'ext-order-storix-31dbiaea', 'LHB-ORD-260808-MAN-0001', '2026-08-08 10:00:00', 'sahar', 'MANUAL', 'BAGHDAD', 'COMPLETED', 14500, 0, 5000, 5000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG6271786175254', '2026-08-09 18:00:00', 'STORIX', 'Customer paid Storix. Hi-Express KRG6271786175254. Storix remittance remains open.'),
  ('10DCG1EH', 'ext-order-storix-10dcg1eh', 'LHB-ORD-260805-WEB-0002', '2026-08-05 10:00:00', 'munjed', 'ONLINE_STORE', 'KARBALA', 'COMPLETED', 8500, 0, 5000, 5000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG0671785957838', '2026-08-07 18:00:00', 'STORIX', 'Customer paid Storix. Hi-Express KRG0671785957838. Storix remittance remains open.'),
  ('075045CE', 'ext-order-storix-wadoud', 'LHB-ORD-260809-WEB-0002', '2026-08-09 11:00:00', 'wadoud', 'ONLINE_STORE', 'BAGHDAD', 'COMPLETED', 17000, 0, 5000, 5000, 'SKIP_HISTORICAL', 'STORIX', 'Storix', 'DELIVERED', 'STO100501986520', '2026-08-11 18:39:18', 'STORIX', 'Wayl draft 075045CE linked to Storix STO100501986520. Customer paid Storix; remittance remains open.'),
  ('STO100501327107', 'ext-order-storix-dhu', 'LHB-ORD-260809-MAN-0004', '2026-08-09 12:00:00', 'dhu', 'MANUAL', 'BAGHDAD', 'COMPLETED', 8500, 0, 5000, 5000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG8041786303200', '2026-08-10 17:11:00', 'STORIX', 'Storix STO100501327107. Hi-Express KRG8041786303200. Customer paid Storix; remittance remains open.'),
  ('D3IA20F0', 'ext-order-storix-d3ia20f0', 'LHB-ORD-260809-MAN-0003', '2026-08-09 13:00:00', 'zha', 'MANUAL', 'BAGHDAD', 'PENDING', 25500, 2500, 5000, 5000, 'NORMAL', 'STORIX', 'Storix', 'IN_TRANSIT', 'D3IA20F0', NULL, 'NONE', 'Pending and unpaid in transit with Storix. One cup pack is a fully discounted gift. No finance or stock posting until delivery.'),
  ('0GB01579', 'ext-order-storix-0gb01579', 'LHB-ORD-260810-MAN-0002', '2026-08-10 10:00:00', 'ali_dabdab', 'MANUAL', 'BAGHDAD', 'PENDING', 25500, 0, 5000, 5000, 'NORMAL', 'STORIX', 'Storix', 'IN_TRANSIT', '0GB01579', NULL, 'NONE', 'Pending and unpaid in transit with Storix. No finance or stock posting until delivery.'),
  ('STO100502420492', 'ext-order-storix-shosha', 'LHB-ORD-260811-MAN-0001', '2026-08-11 10:00:00', 'shosha', 'MANUAL', 'BAGHDAD', 'PENDING', 8500, 0, 5000, 5000, 'NORMAL', 'STORIX', 'Storix', 'IN_TRANSIT', 'STO100502420492', NULL, 'NONE', 'Pending and unpaid in transit with Storix. No finance or stock posting until delivery.'),
  ('STO100501986511', 'ext-order-storix-rasha', 'LHB-ORD-260811-MAN-0002', '2026-08-11 10:05:00', 'rasha', 'MANUAL', 'BAGHDAD', 'PENDING', 14500, 0, 5000, 5000, 'NORMAL', 'STORIX', 'Storix', 'IN_TRANSIT', 'STO100501986511', NULL, 'NONE', 'Pending and unpaid in transit with Storix. No finance or stock posting until delivery.'),
  ('I8I8AA1I', 'ext-order-hi-i8i8aa1i', 'LHB-ORD-260616-WEB-0004', '2026-06-16 12:00:00', 'shahab', 'ONLINE_STORE', 'BAGHDAD', 'COMPLETED', 45000, 0, 5000, 5000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG9091781643292', '2026-06-18 18:00:00', 'HI_EXPRESS', 'Hi-Express KRG9091781643292. Customer paid; net remittance received by 2026-08-01.'),
  ('74974ID4', 'ext-order-hi-74974id4', 'LHB-ORD-260617-WEB-0002', '2026-06-17 12:00:00', 'fatima', 'ONLINE_STORE', 'BAGHDAD', 'COMPLETED', 54000, 0, 5000, 5000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG3891781685420', '2026-06-19 18:00:00', 'HI_EXPRESS', 'Hi-Express KRG3891781685420. Customer paid; net remittance received by 2026-08-01.'),
  ('559A664H', 'ext-order-hi-559a664h', 'LHB-ORD-260618-WEB-0001', '2026-06-18 12:00:00', 'raghad', 'ONLINE_STORE', 'BAGHDAD', 'COMPLETED', 14500, 0, 5000, 5000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG1941781771514', '2026-06-20 18:00:00', 'HI_EXPRESS', 'Hi-Express KRG1941781771514. Customer paid; net remittance received by 2026-08-01.'),
  ('2D55EFEH', 'ext-order-hi-2d55efeh', 'LHB-ORD-260618-WEB-0002', '2026-06-18 12:05:00', 'aqsa', 'ONLINE_STORE', 'BAGHDAD', 'COMPLETED', 17000, 0, 5000, 5000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG4401781771649', '2026-06-20 18:00:00', 'HI_EXPRESS', 'Hi-Express KRG4401781771649. Atlas customer identity retained. Customer paid; net remittance received by 2026-08-01.'),
  ('I5C8B188', 'ext-order-hi-i5c8b188', 'LHB-ORD-260618-WEB-0003', '2026-06-18 12:10:00', 'danya', 'ONLINE_STORE', 'BAGHDAD', 'COMPLETED', 8500, 0, 5000, 5000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG6061781786676', '2026-06-20 18:00:00', 'HI_EXPRESS', 'Hi-Express KRG6061781786676. Customer paid; net remittance received by 2026-08-01.'),
  ('D854E83F', 'ext-order-hi-d854e83f', 'LHB-ORD-260619-WEB-0002', '2026-06-19 12:00:00', 'laheeb', 'ONLINE_STORE', 'BAGHDAD', 'COMPLETED', 14500, 0, 5000, 5000, 'SKIP_HISTORICAL', 'HI_EXPRESS', 'Hi-Express', 'DELIVERED', 'KRG8171781872988', '2026-06-21 18:00:00', 'HI_EXPRESS', 'Hi-Express KRG8171781872988. Customer paid; net remittance received by 2026-08-01.'),
  ('KRG9821786366311', 'ext-order-hi-lubna', 'LHB-ORD-260810-MAN-0003', '2026-08-10 14:00:00', 'lubna', 'MANUAL', 'BAGHDAD', 'PENDING', 22000, 0, 5000, 5000, 'NORMAL', 'HI_EXPRESS', 'Hi-Express', 'DISPATCHED', 'KRG9821786366311', NULL, 'NONE', 'At Hi-Express warehouse. Pending and unpaid; no finance or stock posting until delivery.'),
  ('KRG9591786366540', 'ext-order-hi-aseel', 'LHB-ORD-260810-MAN-0004', '2026-08-10 14:05:00', 'aseel', 'MANUAL', 'ERBIL', 'PENDING', 22000, 0, 5000, 5000, 'NORMAL', 'HI_EXPRESS', 'Hi-Express', 'DISPATCHED', 'KRG9591786366540', NULL, 'NONE', 'At Hi-Express warehouse. Pending and unpaid; no finance or stock posting until delivery. Global City 2526.' );

CREATE TEMP TABLE _external_lines (
  source_key text NOT NULL,
  line_no integer NOT NULL,
  sku text NOT NULL,
  quantity integer NOT NULL,
  unit_gross integer NOT NULL,
  line_discount integer NOT NULL DEFAULT 0,
  PRIMARY KEY (source_key, line_no)
) ON COMMIT DROP;

INSERT INTO _external_lines VALUES
  ('874B6HCI',1,'LHB-TRK-CRD-225-TG-MD',1,8500,0),
  ('8GIFG6B7',1,'LHB-TRK-CRD-225-TG-MD',2,8500,0),
  ('8D717699',1,'LHB-DRP-BOX10-15G-DB-M',1,14500,0), ('8D717699',2,'LHB-TRK-CRD-225-TG-MD',1,8500,0),
  ('656I8DD3',1,'LHB-TRK-CRD-225-TG-MD',1,8500,0), ('656I8DD3',2,'LHB-ACC-CPS-BSC-5PCS',1,2500,0), ('656I8DD3',3,'LHB-DRP-BOX10-15G-DB-M',1,14500,0),
  ('IHID421E',1,'LHB-TRK-CRD-225-TG-MD',1,8500,0), ('IHID421E',2,'LHB-DRP-BOX10-15G-DB-M',1,14500,0),
  ('B0BB68G9',1,'LHB-DRP-BOX10-15G-DB-M',1,14500,0),
  ('D8295I76',1,'LHB-TRK-CRD-225-TG-MD',1,8500,0),
  ('BECI8487',1,'LHB-TRK-CRD-225-TG-MD',1,8500,0), ('BECI8487',2,'LHB-DRP-BOX10-15G-DB-M',1,14500,0), ('BECI8487',3,'LHB-TRK-PLN-225-TG-MD',1,8500,0), ('BECI8487',4,'LHB-ACC-CPS-BSC-5PCS',1,2500,0),
  ('9A817BE0',1,'LHB-TRK-CRD-225-TG-MD',1,8500,0), ('9A817BE0',2,'LHB-DRP-BOX10-15G-DB-M',1,14500,0), ('9A817BE0',3,'LHB-TRK-PLN-225-TG-MD',1,8500,0), ('9A817BE0',4,'LHB-ACC-CPS-BSC-5PCS',1,2500,0),
  ('957I7I6E',1,'LHB-TRK-CRD-225-TG-MD',1,8500,0), ('957I7I6E',2,'LHB-FLT-DCG-225-WB-M',1,13500,0),
  ('31DBIAEA',1,'LHB-DRP-BOX10-15G-DB-M',1,14500,0),
  ('10DCG1EH',1,'LHB-TRK-CRD-225-TG-MD',1,8500,0),
  ('075045CE',1,'LHB-TRK-CRD-225-TG-MD',2,8500,0),
  ('STO100501327107',1,'LHB-TRK-CRD-225-TG-MD',1,8500,0),
  ('D3IA20F0',1,'LHB-DRP-BOX10-15G-DB-M',1,14500,0), ('D3IA20F0',2,'LHB-TRK-CRD-225-TG-MD',1,8500,0), ('D3IA20F0',3,'LHB-ACC-CPS-BSC-5PCS',1,2500,2500),
  ('0GB01579',1,'LHB-DRP-BOX10-15G-DB-M',1,14500,0), ('0GB01579',2,'LHB-ACC-CPS-BSC-5PCS',1,2500,0), ('0GB01579',3,'LHB-TRK-PLN-225-TG-MD',1,8500,0),
  ('STO100502420492',1,'LHB-TRK-PLN-225-TG-MD',1,8500,0),
  ('STO100501986511',1,'LHB-DRP-BOX10-15G-DB-M',1,14500,0),
  ('I8I8AA1I',1,'LHB-TRK-CRD-225-TG-MD',2,8500,0), ('I8I8AA1I',2,'LHB-DRP-BOX10-15G-DB-M',1,14500,0), ('I8I8AA1I',3,'LHB-TRK-PLN-225-TG-MD',1,8500,0), ('I8I8AA1I',4,'LHB-ACC-CPS-BSC-5PCS',2,2500,0),
  ('74974ID4',1,'LHB-ESP-ESPSPR-225-WB-MD',4,13500,0),
  ('559A664H',1,'LHB-DRP-BOX10-15G-DB-M',1,14500,0),
  ('2D55EFEH',1,'LHB-TRK-CRD-225-TG-MD',1,8500,0), ('2D55EFEH',2,'LHB-TRK-PLN-225-TG-MD',1,8500,0),
  ('I5C8B188',1,'LHB-TRK-PLN-225-TG-MD',1,8500,0),
  ('D854E83F',1,'LHB-DRP-BOX10-15G-DB-M',1,14500,0),
  ('KRG9821786366311',1,'LHB-TRK-PLN-225-TG-MD',1,8500,0), ('KRG9821786366311',2,'LHB-ESP-ESPSPR-225-MG-MD',1,13500,0),
  ('KRG9591786366540',1,'LHB-TRK-CRD-225-TG-MD',1,8500,0), ('KRG9591786366540',2,'LHB-FLT-DCG-225-FG-M',1,13500,0);

DO $$
DECLARE
  source_gross_mismatches integer;
  missing_products integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _external_context) THEN RETURN; END IF;
  SELECT count(*) INTO source_gross_mismatches
  FROM _external_orders orders
  LEFT JOIN (
    SELECT source_key, sum(quantity * unit_gross) gross, sum(line_discount) discount
    FROM _external_lines GROUP BY source_key
  ) lines ON lines.source_key = orders.source_key
  WHERE coalesce(lines.gross, 0) <> orders.gross_amount
     OR coalesce(lines.discount, 0) <> orders.discount_amount;
  SELECT count(*) INTO missing_products
  FROM (SELECT DISTINCT sku FROM _external_lines) lines
  LEFT JOIN "Product" product ON product.sku = lines.sku
  WHERE product.id IS NULL;
  IF source_gross_mismatches <> 0 OR missing_products <> 0 THEN
    RAISE EXCEPTION 'Approved order lines do not reconcile: amount mismatches %, missing products %',
      source_gross_mismatches, missing_products;
  END IF;
END $$;

INSERT INTO "Order" (
  id, "orderNumber", "placedAt", "customerId", "branchId", "createdById",
  channel, governorate, "fulfillmentMethod", status, currency, "grossAmount",
  "discountAmount", "orderDiscount", "extraCharges", "refundAmount",
  "deliveryFee", "deliveryCost", notes, "inventorySyncMode", purpose, "createdAt"
)
SELECT
  orders.id, orders.order_number, orders.placed_at, customer.id,
  context.branch_id, context.actor_id, orders.channel, orders.governorate,
  'COURIER', orders.status, 'IQD', orders.gross_amount, orders.discount_amount,
  0, 0, 0, orders.delivery_fee, orders.delivery_cost, orders.notes,
  orders.inventory_mode, 'SALE', CURRENT_TIMESTAMP
FROM _external_orders orders
JOIN _external_customers customer ON customer.customer_key = orders.customer_key
CROSS JOIN _external_context context
ON CONFLICT (id) DO UPDATE SET
  "customerId" = EXCLUDED."customerId",
  status = EXCLUDED.status,
  "grossAmount" = EXCLUDED."grossAmount",
  "discountAmount" = EXCLUDED."discountAmount",
  "deliveryFee" = EXCLUDED."deliveryFee",
  "deliveryCost" = EXCLUDED."deliveryCost",
  notes = EXCLUDED.notes,
  "inventorySyncMode" = EXCLUDED."inventorySyncMode";

INSERT INTO "OrderLine" (
  id, "orderId", "productId", sku, quantity, "unitLabel", "unitGrossPrice",
  "lineDiscount", "lineNet", "unitCogsSnapshot"
)
SELECT
  concat('ext-line-', lower(lines.source_key), '-', lines.line_no),
  orders.id, product.id, product.sku, lines.quantity, product."sellUnit",
  lines.unit_gross, lines.line_discount,
  lines.quantity * lines.unit_gross - lines.line_discount,
  product."cogsPerUnit"
FROM _external_lines lines
JOIN _external_orders orders ON orders.source_key = lines.source_key
JOIN "Product" product ON product.sku = lines.sku
CROSS JOIN _external_context
ON CONFLICT (id) DO UPDATE SET
  quantity = EXCLUDED.quantity,
  "unitGrossPrice" = EXCLUDED."unitGrossPrice",
  "lineDiscount" = EXCLUDED."lineDiscount",
  "lineNet" = EXCLUDED."lineNet",
  "unitCogsSnapshot" = EXCLUDED."unitCogsSnapshot";

INSERT INTO "Shipment" (
  id, "orderId", courier, status, "dispatchedAt", "deliveredAt",
  "shippingCost", governorate, "courierPartyId", "createdAt"
)
SELECT
  concat('ext-shipment-', lower(orders.source_key)), orders.id,
  orders.courier_name, orders.shipment_status, orders.placed_at,
  orders.delivered_at, orders.delivery_cost, orders.governorate,
  party.id, CURRENT_TIMESTAMP
FROM _external_orders orders
JOIN "Party" party ON party."externalKey" = orders.courier_key
CROSS JOIN _external_context
ON CONFLICT ("orderId") DO UPDATE SET
  courier = EXCLUDED.courier,
  status = EXCLUDED.status,
  "dispatchedAt" = EXCLUDED."dispatchedAt",
  "deliveredAt" = EXCLUDED."deliveredAt",
  "shippingCost" = EXCLUDED."shippingCost",
  governorate = EXCLUDED.governorate,
  "courierPartyId" = EXCLUDED."courierPartyId";

-- Correct the four existing orders explicitly approved during source review.
-- Ali was returned by Hi-Express and delivered by Laheeb at no delivery charge.
-- Aws, Saja, Jana, and Mohammed Rayan were collected and remitted by Hi-Express.
UPDATE "Order"
SET
  status = 'COMPLETED',
  "deliveryFee" = 0,
  "deliveryCost" = 0,
  "inventorySyncMode" = 'SKIP_HISTORICAL',
  notes = concat_ws(E'\n', notes, 'External reconciliation: returned by Hi-Express, delivered by Laheeb next day at no delivery fee or cost.')
WHERE id = 'cms76icut0003ie04utalzcjd'
  AND EXISTS (SELECT 1 FROM _external_context);

UPDATE "Order"
SET
  status = 'COMPLETED',
  "deliveryCost" = 5000,
  "inventorySyncMode" = 'SKIP_HISTORICAL',
  notes = concat_ws(E'\n', notes, 'External reconciliation: Hi-Express KRG0031785576315, delivered and fully remitted.')
WHERE id = 'cms7fshaw0004la04inuwb2sf'
  AND EXISTS (SELECT 1 FROM _external_context);

UPDATE "Order"
SET
  status = 'COMPLETED',
  "deliveryCost" = 6000,
  "inventorySyncMode" = 'SKIP_HISTORICAL',
  notes = concat_ws(E'\n', notes, 'External reconciliation: Hi-Express KRG0671785619291, delivered and fully remitted.')
WHERE id = 'cmsaq6czv0004l304l4q8uz4s'
  AND EXISTS (SELECT 1 FROM _external_context);

UPDATE "Order"
SET notes = concat_ws(E'\n', notes, 'External reconciliation: Hi-Express KRG8131781635517, delivered and fully remitted; supersedes the historical Wayl routing.')
WHERE id = 'cmqlk8xtv004vjm04fmbc5r5r'
  AND EXISTS (SELECT 1 FROM _external_context);

UPDATE "Order"
SET
  "inventorySyncMode" = 'SKIP_HISTORICAL',
  notes = concat_ws(E'\n', notes, 'External reconciliation: Hi-Express KRG7621782330424, delivered and fully remitted; supersedes the historical Wayl routing.')
WHERE id = 'cmqt4ire3000aju04kcusosxe'
  AND EXISTS (SELECT 1 FROM _external_context);

INSERT INTO "Shipment" (
  id, "orderId", courier, status, "dispatchedAt", "deliveredAt",
  "shippingCost", governorate, "courierPartyId", "createdAt"
)
SELECT 'ext-shipment-ali-returned', orders.id, 'Laheeb', 'DELIVERED', orders."placedAt",
  '2026-07-31 12:00:00', 0, orders.governorate, NULL, CURRENT_TIMESTAMP
FROM "Order" orders CROSS JOIN _external_context
WHERE orders.id = 'cms76icut0003ie04utalzcjd'
ON CONFLICT ("orderId") DO UPDATE SET
  courier = 'Laheeb', status = 'DELIVERED', "deliveredAt" = EXCLUDED."deliveredAt",
  "shippingCost" = 0, "courierPartyId" = NULL;

CREATE TEMP TABLE _existing_hi_shipments (
  order_id text PRIMARY KEY,
  tracking text NOT NULL,
  delivered_at timestamp NOT NULL,
  shipping_cost integer NOT NULL
) ON COMMIT DROP;

INSERT INTO _existing_hi_shipments VALUES
  ('cms7fshaw0004la04inuwb2sf', 'KRG0031785576315', '2026-08-05 17:45:01', 5000),
  ('cmsaq6czv0004l304l4q8uz4s', 'KRG0671785619291', '2026-08-05 13:44:04', 6000),
  ('cmqlk8xtv004vjm04fmbc5r5r', 'KRG8131781635517', '2026-06-18 18:00:00', 5000),
  ('cmqt4ire3000aju04kcusosxe', 'KRG7621782330424', '2026-06-25 18:00:00', 5000);

INSERT INTO "Shipment" (
  id, "orderId", courier, status, "dispatchedAt", "deliveredAt",
  "shippingCost", governorate, "courierPartyId", "createdAt"
)
SELECT concat('ext-shipment-correction-', source.order_id), source.order_id,
  'Hi-Express', 'DELIVERED', orders."placedAt", source.delivered_at,
  source.shipping_cost, orders.governorate, provider.id, CURRENT_TIMESTAMP
FROM _existing_hi_shipments source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" provider ON provider."externalKey" = 'HI_EXPRESS'
CROSS JOIN _external_context
ON CONFLICT ("orderId") DO UPDATE SET
  courier = EXCLUDED.courier, status = 'DELIVERED',
  "deliveredAt" = EXCLUDED."deliveredAt", "shippingCost" = EXCLUDED."shippingCost",
  "courierPartyId" = EXCLUDED."courierPartyId";

-- Archive only the superseded finance legs on the five corrected orders.
CREATE TEMP TABLE _superseded_order_finance ON COMMIT DROP AS
SELECT entry.id
FROM "FinanceEntry" entry
WHERE entry."orderId" IN (
    'cms76icut0003ie04utalzcjd', 'cms7fshaw0004la04inuwb2sf',
    'cmsaq6czv0004l304l4q8uz4s', 'cmqlk8xtv004vjm04fmbc5r5r',
    'cmqt4ire3000aju04kcusosxe'
  )
  AND entry."archivedAt" IS NULL
  AND (
    (entry.obligation = true AND entry."obligationKind" = 'RECEIVABLE')
    OR entry."costRole" = 'DIRECT_DELIVERY'
  )
  AND EXISTS (SELECT 1 FROM _external_context);

UPDATE "FinanceEntry"
SET
  "archivedAt" = CURRENT_TIMESTAMP,
  "archivedById" = (SELECT actor_id FROM _external_context),
  "archiveReason" = 'Superseded by approved 2026-08-12 external report reconciliation.'
WHERE "settlesId" IN (SELECT id FROM _superseded_order_finance)
  AND "archivedAt" IS NULL;

UPDATE "FinanceEntry"
SET
  "archivedAt" = CURRENT_TIMESTAMP,
  "archivedById" = (SELECT actor_id FROM _external_context),
  "archiveReason" = 'Superseded by approved 2026-08-12 external report reconciliation.'
WHERE id IN (SELECT id FROM _superseded_order_finance)
  AND "archivedAt" IS NULL;

-- Ali's corrected invoice was paid directly into Cash on Hands.
INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "accountId", "paymentMethod",
  "importKey", description, reference, "branchId", "orderId", "createdById", "createdAt"
)
SELECT 'ext-payment-ali-direct', '2026-07-31 12:00:00', 'INCOME', 14500, 'IQD', false,
  context.cash_account_id, 'CASH', 'EXTREP:20260812:ALI:DIRECT',
  'Direct payment after Laheeb delivery', orders."orderNumber", orders."branchId",
  orders.id, context.actor_id, CURRENT_TIMESTAMP
FROM "Order" orders CROSS JOIN _external_context context
WHERE orders.id = 'cms76icut0003ie04utalzcjd'
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "accountId" = EXCLUDED."accountId",
  "archivedAt" = NULL, "archiveReason" = NULL;

-- Build the exact Hi-Express collection set: six newly reconstructed orders
-- plus four existing orders whose prior payment routing was incomplete/wrong.
CREATE TEMP TABLE _hi_settlement_source ON COMMIT DROP AS
SELECT
  orders.source_key,
  orders.id AS order_id,
  orders.gross_amount - orders.discount_amount + orders.delivery_fee AS gross,
  orders.delivery_cost AS fee,
  CASE WHEN orders.delivered_at <= '2026-08-01 23:59:59'
    THEN '2026-08-01 23:59:59'::timestamp ELSE orders.delivered_at END AS settlement_date,
  orders.tracking
FROM _external_orders orders
WHERE orders.payment_route = 'HI_EXPRESS' AND orders.status = 'COMPLETED'
UNION ALL VALUES
  ('AWS', 'cms7fshaw0004la04inuwb2sf', 19500, 5000, '2026-08-05 17:45:01'::timestamp, 'KRG0031785576315'),
  ('SAJA', 'cmsaq6czv0004l304l4q8uz4s', 30000, 6000, '2026-08-05 13:44:04'::timestamp, 'KRG0671785619291'),
  ('JANA', 'cmqlk8xtv004vjm04fmbc5r5r', 19500, 5000, '2026-08-01 23:59:59'::timestamp, 'KRG8131781635517'),
  ('MOHAMMED_RAYAN', 'cmqt4ire3000aju04kcusosxe', 22000, 5000, '2026-08-01 23:59:59'::timestamp, 'KRG7621782330424');

INSERT INTO "ProviderSettlement" (
  id, "providerPartyId", "accountId", date, "grossCleared", "feesOffset",
  "amountReceived", "paymentMethod", reference, "createdById", "createdAt"
)
SELECT concat('ext-hi-settlement-', lower(source.source_key)), provider.id,
  context.cash_account_id, source.settlement_date, source.gross, source.fee,
  source.gross - source.fee, 'CASH', concat('EXTREP-20260812-HI-', source.source_key),
  context.actor_id, CURRENT_TIMESTAMP
FROM _hi_settlement_source source
JOIN "Party" provider ON provider."externalKey" = 'HI_EXPRESS'
CROSS JOIN _external_context context
ON CONFLICT (reference) DO UPDATE SET
  "grossCleared" = EXCLUDED."grossCleared", "feesOffset" = EXCLUDED."feesOffset",
  "amountReceived" = EXCLUDED."amountReceived", date = EXCLUDED.date;

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "obligationKind", "partyId",
  "importKey", description, reference, "branchId", "orderId", "createdById", "createdAt"
)
SELECT concat('ext-hi-ar-', lower(source.source_key)), orders."placedAt", 'INCOME',
  source.gross, 'IQD', true, 'RECEIVABLE', provider.id,
  concat('ORD:', orders.id, ':PROVIDER'),
  'Customer payment collected by Hi-Express', source.tracking,
  orders."branchId", orders.id, context.actor_id, CURRENT_TIMESTAMP
FROM _hi_settlement_source source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" provider ON provider."externalKey" = 'HI_EXPRESS'
CROSS JOIN _external_context context
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "partyId" = EXCLUDED."partyId",
  "archivedAt" = NULL, "archiveReason" = NULL;

INSERT INTO "FinanceEntry" (
  id, date, type, "recordClass", amount, currency, obligation, "obligationKind",
  "partyId", "categoryType", "costRole", "importKey", description, reference,
  "branchId", "orderId", "createdById", "createdAt"
)
SELECT concat('ext-hi-fee-', lower(source.source_key)), orders."placedAt", 'EXPENSE',
  'EXPENSE', source.fee, 'IQD', true, 'PAYABLE', provider.id, 'SHIPPING',
  'DIRECT_DELIVERY', concat('SHIP:', orders.id, ':COST'),
  'Hi-Express delivery fee deducted from remittance', source.tracking,
  orders."branchId", orders.id, context.actor_id, CURRENT_TIMESTAMP
FROM _hi_settlement_source source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" provider ON provider."externalKey" = 'HI_EXPRESS'
CROSS JOIN _external_context context
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "partyId" = EXCLUDED."partyId",
  "archivedAt" = NULL, "archiveReason" = NULL;

INSERT INTO "LedgerEntryLine" (
  id, "financeEntryId", "lineNo", "itemType", "itemName", "categoryType",
  unit, quantity, "unitCost", "landedUnitCost", "lineTotal", "branchId", notes,
  "spendTreatment", "classificationStatus", "classificationSource"
)
SELECT concat('ext-hi-fee-line-', lower(source.source_key)), fee.id, 1, 'SERVICE',
  'Hi-Express delivery', 'SHIPPING', 'service', 1, source.fee, source.fee,
  source.fee, orders."branchId", source.tracking, 'OPEX', 'CONFIRMED',
  'approved-external-report-2026-08-12'
FROM _hi_settlement_source source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "FinanceEntry" fee ON fee."importKey" = concat('SHIP:', orders.id, ':COST')
CROSS JOIN _external_context
ON CONFLICT ("financeEntryId", "lineNo") DO UPDATE SET
  "lineTotal" = EXCLUDED."lineTotal", "unitCost" = EXCLUDED."unitCost",
  "landedUnitCost" = EXCLUDED."landedUnitCost";

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "accountId", "partyId",
  "paymentMethod", "settlesId", "importKey", description, reference,
  "branchId", "orderId", "createdById", "providerSettlementId", "createdAt"
)
SELECT concat('ext-hi-cash-', lower(source.source_key)), source.settlement_date,
  'PAYMENT_IN', source.gross - source.fee, 'IQD', false, context.cash_account_id,
  provider.id, 'CASH', receivable.id,
  concat('EXTREP:20260812:HI:', source.source_key, ':CASH'),
  'Net Hi-Express remittance received', source.tracking, orders."branchId",
  orders.id, context.actor_id, settlement.id, CURRENT_TIMESTAMP
FROM _hi_settlement_source source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" provider ON provider."externalKey" = 'HI_EXPRESS'
JOIN "FinanceEntry" receivable ON receivable."importKey" = concat('ORD:', orders.id, ':PROVIDER')
JOIN "ProviderSettlement" settlement ON settlement.reference = concat('EXTREP-20260812-HI-', source.source_key)
CROSS JOIN _external_context context
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "accountId" = EXCLUDED."accountId",
  "settlesId" = EXCLUDED."settlesId", "providerSettlementId" = EXCLUDED."providerSettlementId",
  "archivedAt" = NULL, "archiveReason" = NULL;

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "partyId", "paymentMethod",
  "settlesId", "importKey", description, reference, "branchId", "orderId",
  "createdById", "providerSettlementId", "createdAt"
)
SELECT concat('ext-hi-offset-in-', lower(source.source_key)), source.settlement_date,
  'PAYMENT_IN', source.fee, 'IQD', false, provider.id, 'OFFSET', receivable.id,
  concat('EXTREP:20260812:HI:', source.source_key, ':OFFSET:IN'),
  'Hi-Express fee offset against receivable', source.tracking, orders."branchId",
  orders.id, context.actor_id, settlement.id, CURRENT_TIMESTAMP
FROM _hi_settlement_source source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" provider ON provider."externalKey" = 'HI_EXPRESS'
JOIN "FinanceEntry" receivable ON receivable."importKey" = concat('ORD:', orders.id, ':PROVIDER')
JOIN "ProviderSettlement" settlement ON settlement.reference = concat('EXTREP-20260812-HI-', source.source_key)
CROSS JOIN _external_context context
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "settlesId" = EXCLUDED."settlesId",
  "providerSettlementId" = EXCLUDED."providerSettlementId",
  "archivedAt" = NULL, "archiveReason" = NULL;



INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "partyId", "paymentMethod",
  "settlesId", "importKey", description, reference, "branchId", "orderId",
  "createdById", "providerSettlementId", "createdAt"
)
SELECT concat('ext-hi-offset-out-', lower(source.source_key)), source.settlement_date,
  'PAYMENT_OUT', source.fee, 'IQD', false, provider.id, 'OFFSET', fee.id,
  concat('EXTREP:20260812:HI:', source.source_key, ':OFFSET:OUT'),
  'Hi-Express fee settled from remittance', source.tracking, orders."branchId",
  orders.id, context.actor_id, settlement.id, CURRENT_TIMESTAMP
FROM _hi_settlement_source source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" provider ON provider."externalKey" = 'HI_EXPRESS'
JOIN "FinanceEntry" fee ON fee."importKey" = concat('SHIP:', orders.id, ':COST')
JOIN "ProviderSettlement" settlement ON settlement.reference = concat('EXTREP-20260812-HI-', source.source_key)
CROSS JOIN _external_context context
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "settlesId" = EXCLUDED."settlesId",
  "providerSettlementId" = EXCLUDED."providerSettlementId",
  "archivedAt" = NULL, "archiveReason" = NULL;

-- Existing 877GFEBD was already paid directly. Retain the receipt, attach the
-- confirmed Hi-Express fee, and close that fee without duplicating sales.
UPDATE "Order"
SET notes = concat_ws(E'\n', notes, 'External reconciliation: confirmed delivered by Hi-Express; existing customer cash receipt retained.')
WHERE id = 'cmqlk9ien007xlg04o2ozfeuu'
  AND EXISTS (SELECT 1 FROM _external_context);

UPDATE "Shipment"
SET status = 'DELIVERED', "deliveredAt" = coalesce("deliveredAt", '2026-08-01 23:59:59')
WHERE "orderId" = 'cmqlk9ien007xlg04o2ozfeuu'
  AND EXISTS (SELECT 1 FROM _external_context);

UPDATE "FinanceEntry"
SET
  "partyId" = (SELECT id FROM "Party" WHERE "externalKey" = 'HI_EXPRESS'),
  description = 'Confirmed Hi-Express delivery fee',
  "archiveReason" = NULL
WHERE id = 'finance-missing-courier-cmqlk9ien007xlg04o2ozfeuu'
  AND EXISTS (SELECT 1 FROM _external_context);

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "accountId", "partyId",
  "paymentMethod", "settlesId", "importKey", description, "branchId", "orderId",
  "createdById", "createdAt"
)
SELECT 'ext-payment-877-courier', '2026-08-01 23:59:59', 'PAYMENT_OUT', 5000,
  'IQD', false, context.cash_account_id, provider.id, 'CASH', fee.id,
  'EXTREP:20260812:877:COURIER', 'Confirmed Hi-Express fee paid', orders."branchId",
  orders.id, context.actor_id, CURRENT_TIMESTAMP
FROM "Order" orders
JOIN "FinanceEntry" fee ON fee.id = 'finance-missing-courier-cmqlk9ien007xlg04o2ozfeuu'
JOIN "Party" provider ON provider."externalKey" = 'HI_EXPRESS'
CROSS JOIN _external_context context
WHERE orders.id = 'cmqlk9ien007xlg04o2ozfeuu'
ON CONFLICT ("importKey") DO UPDATE SET
  "settlesId" = EXCLUDED."settlesId", "partyId" = EXCLUDED."partyId",
  "archivedAt" = NULL, "archiveReason" = NULL;

-- Completed Storix orders are customer-paid but not yet remitted to Laheeb.
-- The gross provider receivable marks the invoice paid; the courier deduction
-- clears the matching fee payable and leaves only the approved net receivable.
CREATE TEMP TABLE _storix_source ON COMMIT DROP AS
SELECT
  orders.source_key,
  orders.id AS order_id,
  orders.gross_amount - orders.discount_amount + orders.delivery_fee AS gross,
  orders.delivery_cost AS fee,
  orders.tracking,
  orders.placed_at
FROM _external_orders orders
WHERE orders.payment_route = 'STORIX' AND orders.status = 'COMPLETED';

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "obligationKind", "partyId",
  "importKey", description, reference, "branchId", "orderId", "createdById", "createdAt"
)
SELECT concat('ext-storix-ar-', lower(source.source_key)), source.placed_at,
  'INCOME', source.gross, 'IQD', true, 'RECEIVABLE', provider.id,
  concat('ORD:', orders.id, ':PROVIDER'),
  'Customer payment collected by Storix; net remittance remains open',
  source.tracking, orders."branchId", orders.id, context.actor_id, CURRENT_TIMESTAMP
FROM _storix_source source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" provider ON provider."externalKey" = 'STORIX'
CROSS JOIN _external_context context
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "partyId" = EXCLUDED."partyId",
  "archivedAt" = NULL, "archiveReason" = NULL;

INSERT INTO "FinanceEntry" (
  id, date, type, "recordClass", amount, currency, obligation, "obligationKind",
  "partyId", "categoryType", "costRole", "importKey", description, reference,
  "branchId", "orderId", "createdById", "createdAt"
)
SELECT concat('ext-storix-fee-', lower(source.source_key)), source.placed_at,
  'EXPENSE', 'EXPENSE', source.fee, 'IQD', true, 'PAYABLE', provider.id,
  'SHIPPING', 'DIRECT_DELIVERY',
  concat('SHIP:', orders.id, ':COST'),
  'Delivery fee deducted by Storix before remittance', source.tracking,
  orders."branchId", orders.id, context.actor_id, CURRENT_TIMESTAMP
FROM _storix_source source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" provider ON provider."externalKey" = 'STORIX'
CROSS JOIN _external_context context
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "partyId" = EXCLUDED."partyId",
  "archivedAt" = NULL, "archiveReason" = NULL;

INSERT INTO "LedgerEntryLine" (
  id, "financeEntryId", "lineNo", "itemType", "itemName", "categoryType",
  unit, quantity, "unitCost", "landedUnitCost", "lineTotal", "branchId", notes,
  "spendTreatment", "classificationStatus", "classificationSource"
)
SELECT concat('ext-storix-fee-line-', lower(source.source_key)), fee.id, 1,
  'SERVICE', 'Storix delivery deduction', 'SHIPPING', 'service', 1,
  source.fee, source.fee, source.fee, orders."branchId", source.tracking,
  'OPEX', 'CONFIRMED', 'approved-external-report-2026-08-12'
FROM _storix_source source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "FinanceEntry" fee ON fee."importKey" = concat('SHIP:', orders.id, ':COST')
CROSS JOIN _external_context
ON CONFLICT ("financeEntryId", "lineNo") DO UPDATE SET
  "lineTotal" = EXCLUDED."lineTotal", "unitCost" = EXCLUDED."unitCost",
  "landedUnitCost" = EXCLUDED."landedUnitCost";

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "partyId", "paymentMethod",
  "settlesId", "importKey", description, reference, "branchId", "orderId",
  "createdById", "createdAt"
)
SELECT concat('ext-storix-offset-in-', lower(source.source_key)), source.placed_at,
  'PAYMENT_IN', source.fee, 'IQD', false, provider.id, 'OFFSET', receivable.id,
  concat('EXTREP:20260812:STORIX:', source.source_key, ':OFFSET:IN'),
  'Storix fee offset against provider receivable', source.tracking,
  orders."branchId", orders.id, context.actor_id, CURRENT_TIMESTAMP
FROM _storix_source source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" provider ON provider."externalKey" = 'STORIX'
JOIN "FinanceEntry" receivable ON receivable."importKey" = concat('ORD:', orders.id, ':PROVIDER')
CROSS JOIN _external_context context
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "settlesId" = EXCLUDED."settlesId",
  "archivedAt" = NULL, "archiveReason" = NULL;

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "partyId", "paymentMethod",
  "settlesId", "importKey", description, reference, "branchId", "orderId",
  "createdById", "createdAt"
)
SELECT concat('ext-storix-offset-out-', lower(source.source_key)), source.placed_at,
  'PAYMENT_OUT', source.fee, 'IQD', false, provider.id, 'OFFSET', fee.id,
  concat('EXTREP:20260812:STORIX:', source.source_key, ':OFFSET:OUT'),
  'Storix delivery fee settled from provider collection', source.tracking,
  orders."branchId", orders.id, context.actor_id, CURRENT_TIMESTAMP
FROM _storix_source source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" provider ON provider."externalKey" = 'STORIX'
JOIN "FinanceEntry" fee ON fee."importKey" = concat('SHIP:', orders.id, ':COST')
CROSS JOIN _external_context context
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "settlesId" = EXCLUDED."settlesId",
  "archivedAt" = NULL, "archiveReason" = NULL;

-- Rebuild the complete Wayl statement from exact external codes. These rows
-- supersede the earlier fuzzy/pool allocation while retaining a stable audit trail.
CREATE TEMP TABLE _wayl_exact (
  code text PRIMARY KEY,
  occurred_at timestamp NOT NULL,
  gross integer NOT NULL,
  fee integer NOT NULL,
  order_id text NOT NULL
) ON COMMIT DROP;

INSERT INTO _wayl_exact VALUES
  ('1A52C792','2026-05-19 12:00:00',32000,1720,'cmqljxrnt003clg049c69sdk1'),
  ('998C8C52','2026-05-19 12:05:00',19500,1282,'cmqljyizd000qjm04q2rurk0k'),
  ('E3FCD7DA','2026-05-22 12:00:00',22000,1370,'cmqljz71g001ajm04mk861uqe'),
  ('EB5369GD','2026-05-22 12:05:00',19500,1282,'cmqljz8f4001ijm04un00jrfh'),
  ('I9D0FC09','2026-05-27 12:00:00',22000,1370,'cmqlk3knw002ejm04021s725z'),
  ('I56H8BB5','2026-05-31 12:00:00',19500,1282,'cmqlk3nbt002vjm04ij2lppxk'),
  ('G8G9AHEI','2026-06-01 12:00:00',18500,1247,'cmqlk3oju0032jm0447eqdj61'),
  ('874B6HCI','2026-06-22 12:00:00',13500,1072,'ext-order-wayl-874b6hci'),
  ('8GIFG6B7','2026-07-01 12:00:00',22000,1370,'ext-order-wayl-8gifg6b7'),
  ('8D717699','2026-07-13 12:00:00',28000,1580,'ext-order-wayl-8d717699'),
  ('656I8DD3','2026-07-28 12:00:00',30500,1667,'ext-order-wayl-656i8dd3'),
  ('IHID421E','2026-07-28 12:05:00',28000,1580,'ext-order-wayl-ihid421e'),
  ('B0BB68G9','2026-08-01 12:00:00',19500,1282,'ext-order-wayl-b0bb68g9'),
  ('D8295I76','2026-08-05 12:00:00',13500,1072,'ext-order-wayl-d8295i76'),
  ('BECI8487','2026-08-07 12:00:00',39000,1965,'ext-order-wayl-beci8487'),
  ('9A817BE0','2026-08-07 12:05:00',39000,1965,'ext-order-wayl-9a817be0'),
  ('688E6C1G','2026-08-10 12:59:15.572',16000,1160,'correction-order-wayl-688e6c1g');

DO $$
DECLARE mismatches integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _external_context) THEN RETURN; END IF;
  SELECT count(*) INTO mismatches
  FROM _wayl_exact source
  LEFT JOIN "Order" orders ON orders.id = source.order_id
  WHERE orders.id IS NULL
     OR source.gross <> GREATEST(
       orders."grossAmount" - orders."discountAmount" - orders."refundAmount"
         + orders."deliveryFee" + orders."extraCharges", 0
     );
  IF mismatches <> 0 THEN
    RAISE EXCEPTION 'Exact Wayl rows do not match approved Atlas invoices: %', mismatches;
  END IF;
END $$;

-- Remove the old unmatched-deposit liabilities now that every statement row
-- has an approved order, and replace every exact order with one Wayl AR.
UPDATE "FinanceEntry"
SET "archivedAt" = CURRENT_TIMESTAMP,
  "archivedById" = (SELECT actor_id FROM _external_context),
  "archiveReason" = 'Exact Wayl order mapping approved on 2026-08-12.'
WHERE "importKey" LIKE 'WAYL:STATEMENT:%:CUSTOMER_DEPOSIT'
  AND "archivedAt" IS NULL
  AND EXISTS (SELECT 1 FROM _external_context);

CREATE TEMP TABLE _wayl_superseded_receivables ON COMMIT DROP AS
SELECT entry.id
FROM "FinanceEntry" entry
WHERE entry."orderId" IN (SELECT order_id FROM _wayl_exact)
  AND entry.obligation = true
  AND entry."obligationKind" = 'RECEIVABLE'
  AND entry."importKey" IS DISTINCT FROM concat('ORD:', entry."orderId", ':PROVIDER')
  AND entry."archivedAt" IS NULL
  AND EXISTS (SELECT 1 FROM _external_context);

UPDATE "FinanceEntry"
SET "archivedAt" = CURRENT_TIMESTAMP,
  "archivedById" = (SELECT actor_id FROM _external_context),
  "archiveReason" = 'Superseded by exact Wayl statement receivable.'
WHERE "settlesId" IN (SELECT id FROM _wayl_superseded_receivables)
  AND "importKey" NOT LIKE 'WAYL:STATEMENT:%:GROSS'
  AND "archivedAt" IS NULL;

UPDATE "FinanceEntry"
SET "archivedAt" = CURRENT_TIMESTAMP,
  "archivedById" = (SELECT actor_id FROM _external_context),
  "archiveReason" = 'Superseded by exact Wayl statement receivable.'
WHERE id IN (SELECT id FROM _wayl_superseded_receivables)
  AND "archivedAt" IS NULL;

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "obligationKind", "partyId",
  "importKey", description, reference, "branchId", "orderId", "createdById", "createdAt"
)
SELECT concat('ext-wayl-ar-', lower(source.code)), orders."placedAt", 'INCOME',
  source.gross, 'IQD', true, 'RECEIVABLE', provider.id,
  concat('ORD:', orders.id, ':PROVIDER'),
  'Customer payment collected by Wayl', source.code, orders."branchId",
  orders.id, context.actor_id, CURRENT_TIMESTAMP
FROM _wayl_exact source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" provider ON provider."externalKey" = 'WAYL'
CROSS JOIN _external_context context
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "partyId" = EXCLUDED."partyId",
  "archivedAt" = NULL, "archiveReason" = NULL;

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "accountId", "partyId",
  "paymentMethod", "settlesId", "importKey", description, reference,
  "branchId", "orderId", "createdById", "createdAt"
)
SELECT concat('wayl-statement-receipt-', source.code), source.occurred_at,
  'PAYMENT_IN', source.gross, 'IQD', false, context.wayl_account_id,
  provider.id, 'Online payment', receivable.id,
  concat('WAYL:STATEMENT:', source.code, ':GROSS'), 'Exact Wayl statement receipt',
  source.code, orders."branchId", orders.id, context.actor_id, CURRENT_TIMESTAMP
FROM _wayl_exact source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" provider ON provider."externalKey" = 'WAYL'
JOIN "FinanceEntry" receivable ON receivable."importKey" = concat('ORD:', orders.id, ':PROVIDER')
CROSS JOIN _external_context context
ON CONFLICT ("importKey") DO UPDATE SET
  date = EXCLUDED.date, amount = EXCLUDED.amount, "accountId" = EXCLUDED."accountId",
  "partyId" = EXCLUDED."partyId", "settlesId" = EXCLUDED."settlesId",
  "orderId" = EXCLUDED."orderId", "archivedAt" = NULL, "archiveReason" = NULL;

INSERT INTO "FinanceEntry" (
  id, date, type, "recordClass", amount, currency, obligation, "accountId",
  "partyId", "categoryType", "costRole", "paymentMethod", "importKey",
  description, reference, "branchId", "orderId", "createdById", "createdAt"
)
SELECT concat('wayl-statement-fee-', source.code), source.occurred_at,
  'EXPENSE', 'EXPENSE', source.fee, 'IQD', false, context.wayl_account_id,
  provider.id, 'TECH', 'PAYMENT_PROCESSING', 'Online payment',
  concat('WAYL:STATEMENT:', source.code, ':FEE'), 'Exact Wayl statement commission',
  source.code, orders."branchId", orders.id, context.actor_id, CURRENT_TIMESTAMP
FROM _wayl_exact source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" provider ON provider."externalKey" = 'WAYL'
CROSS JOIN _external_context context
ON CONFLICT ("importKey") DO UPDATE SET
  date = EXCLUDED.date, amount = EXCLUDED.amount, "accountId" = EXCLUDED."accountId",
  "partyId" = EXCLUDED."partyId", "orderId" = EXCLUDED."orderId",
  "archivedAt" = NULL, "archiveReason" = NULL;

INSERT INTO "LedgerEntryLine" (
  id, "financeEntryId", "lineNo", "itemType", "itemName", "categoryType",
  unit, quantity, "unitCost", "landedUnitCost", "lineTotal", "branchId",
  "spendTreatment", "classificationStatus", "classificationSource"
)
SELECT concat('wayl-statement-fee-line-', source.code), fee.id, 1, 'SERVICE',
  'Wayl payment processing', 'TECH', 'service', 1, source.fee, source.fee,
  source.fee, orders."branchId", 'OPEX', 'CONFIRMED', 'exact-wayl-statement-2026-08-12'
FROM _wayl_exact source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "FinanceEntry" fee ON fee."importKey" = concat('WAYL:STATEMENT:', source.code, ':FEE')
CROSS JOIN _external_context
ON CONFLICT ("financeEntryId", "lineNo") DO UPDATE SET
  "lineTotal" = EXCLUDED."lineTotal", "unitCost" = EXCLUDED."unitCost",
  "landedUnitCost" = EXCLUDED."landedUnitCost";

INSERT INTO "PaymentReconciliationItem" (
  id, "providerPartyId", "orderId", "occurredAt", "externalCode",
  "sourceReference", "grossAmount", "feeAmount", "netAmount", status,
  "receiptEntryId", "feeEntryId", metadata, "createdAt", "updatedAt"
)
SELECT concat('wayl-reconciliation-', source.code), provider.id, orders.id,
  source.occurred_at, source.code, 'Wayle transactions report.csv', source.gross,
  source.fee, source.gross - source.fee, 'LINKED', receipt.id, fee.id,
  jsonb_build_object('source', 'approved Wayl statement 2026-08-12',
    'allocationMode', 'exact-code-to-order', 'statementOverride', true),
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM _wayl_exact source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" provider ON provider."externalKey" = 'WAYL'
JOIN "FinanceEntry" receipt ON receipt."importKey" = concat('WAYL:STATEMENT:', source.code, ':GROSS')
JOIN "FinanceEntry" fee ON fee."importKey" = concat('WAYL:STATEMENT:', source.code, ':FEE')
CROSS JOIN _external_context
ON CONFLICT ("providerPartyId", "externalCode") DO UPDATE SET
  "orderId" = EXCLUDED."orderId", "occurredAt" = EXCLUDED."occurredAt",
  "grossAmount" = EXCLUDED."grossAmount", "feeAmount" = EXCLUDED."feeAmount",
  "netAmount" = EXCLUDED."netAmount", status = 'LINKED',
  "receiptEntryId" = EXCLUDED."receiptEntryId", "feeEntryId" = EXCLUDED."feeEntryId",
  metadata = EXCLUDED.metadata, "updatedAt" = CURRENT_TIMESTAMP;

CREATE TEMP TABLE _wayl_payout_exact (
  payout_ref text PRIMARY KEY,
  payout_date timestamp NOT NULL,
  amount integer NOT NULL
) ON COMMIT DROP;

INSERT INTO _wayl_payout_exact VALUES
  ('01KSHMJ9RP82B5D89AA9RXP8CC','2026-05-26 12:00:00',87346),
  ('01KT1MHDRRHCM3VTVC6B88D7SK','2026-06-02 12:00:00',20630),
  ('01KTNT2QBGD9P0BG65MZP2TWH0','2026-06-09 12:00:00',35471),
  ('01KW9C30FDB8DQS5TRQA61BXJE','2026-06-30 12:00:00',12428),
  ('01KWW2JYFDVVZKZKJ0GSNXBFP2','2026-07-07 12:00:00',20630),
  ('01KXZVB9R7AJSRXX55NVSW17QX','2026-07-21 12:00:00',26420),
  ('01KZ3G4KHHFG7GDV5F4RVFR9WX','2026-08-04 12:00:00',73471),
  ('01KZNM7RXR8G4CRK0TZJ72BXZ0','2026-08-11 12:00:00',86498);

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "accountId", "toAccountId",
  "paymentMethod", "importKey", description, reference, "createdById", "createdAt"
)
SELECT concat('ext-wayl-payout-', lower(source.payout_ref)), source.payout_date,
  'TRANSFER', source.amount, 'IQD', false, context.wayl_account_id,
  context.fib_account_id, 'Bank transfer',
  concat('WAYL:PAYOUT:REF:', source.payout_ref), 'Wayl payout to FIB',
  source.payout_ref, context.actor_id, CURRENT_TIMESTAMP
FROM _wayl_payout_exact source CROSS JOIN _external_context context
ON CONFLICT ("importKey") DO UPDATE SET
  date = EXCLUDED.date, amount = EXCLUDED.amount, "accountId" = EXCLUDED."accountId",
  "toAccountId" = EXCLUDED."toAccountId", reference = EXCLUDED.reference,
  "archivedAt" = NULL, "archiveReason" = NULL;

-- Archive the six date-only legacy payouts after their reference-keyed exact
-- replacements are present. The two August payouts are new.
UPDATE "FinanceEntry"
SET "archivedAt" = CURRENT_TIMESTAMP,
  "archivedById" = (SELECT actor_id FROM _external_context),
  "archiveReason" = 'Replaced by reference-keyed exact Wayl payout.'
WHERE "importKey" LIKE 'WAYL:PAYOUT:____-__-__'
  AND "archivedAt" IS NULL
  AND EXISTS (SELECT 1 FROM _external_context);

-- Keep the older aggregate Wayl settlement header equal to its surviving
-- linked cash rows after Jana and Mohammed Rayan are rerouted to Hi-Express.
UPDATE "ProviderSettlement" settlement
SET
  "grossCleared" = totals.amount,
  "feesOffset" = 0,
  "amountReceived" = totals.amount
FROM (
  SELECT entry."providerSettlementId", COALESCE(SUM(entry.amount), 0)::integer AS amount
  FROM "FinanceEntry" entry
  WHERE entry."providerSettlementId" IS NOT NULL
    AND entry.type = 'PAYMENT_IN'
    AND entry."accountId" IS NOT NULL
    AND entry."archivedAt" IS NULL
    AND entry."reversedAt" IS NULL
    AND entry."reversalOfId" IS NULL
  GROUP BY entry."providerSettlementId"
) totals
WHERE settlement.id = totals."providerSettlementId"
  AND settlement.reference = 'RECON-20260712-WAYL'
  AND EXISTS (SELECT 1 FROM _external_context);

-- Courier fees for the reconstructed Wayl orders were paid in advance. They
-- are separate operating expenses and never reduce Wayl payment receipts.
CREATE TEMP TABLE _direct_courier_fee ON COMMIT DROP AS
SELECT orders.source_key, orders.id AS order_id, orders.delivery_cost AS fee,
  orders.courier_key, orders.tracking, orders.placed_at
FROM _external_orders orders
WHERE orders.payment_route = 'WAYL' AND orders.delivery_cost > 0;

INSERT INTO "FinanceEntry" (
  id, date, type, "recordClass", amount, currency, obligation, "obligationKind",
  "partyId", "categoryType", "costRole", "importKey", description, reference,
  "branchId", "orderId", "createdById", "createdAt"
)
SELECT concat('ext-courier-fee-', lower(source.source_key)), source.placed_at,
  'EXPENSE', 'EXPENSE', source.fee, 'IQD', true, 'PAYABLE', courier.id,
  'SHIPPING', 'DIRECT_DELIVERY',
  concat('SHIP:', orders.id, ':COST'),
  concat(courier.name, ' fee paid in advance'), source.tracking,
  orders."branchId", orders.id, context.actor_id, CURRENT_TIMESTAMP
FROM _direct_courier_fee source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" courier ON courier."externalKey" = source.courier_key
CROSS JOIN _external_context context
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "partyId" = EXCLUDED."partyId",
  "archivedAt" = NULL, "archiveReason" = NULL;

INSERT INTO "LedgerEntryLine" (
  id, "financeEntryId", "lineNo", "itemType", "itemName", "categoryType",
  unit, quantity, "unitCost", "landedUnitCost", "lineTotal", "branchId", notes,
  "spendTreatment", "classificationStatus", "classificationSource"
)
SELECT concat('ext-courier-fee-line-', lower(source.source_key)), fee.id, 1,
  'SERVICE', 'Courier delivery', 'SHIPPING', 'service', 1, source.fee, source.fee,
  source.fee, orders."branchId", source.tracking, 'OPEX', 'CONFIRMED',
  'approved-external-report-2026-08-12'
FROM _direct_courier_fee source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "FinanceEntry" fee ON fee."importKey" = concat('SHIP:', orders.id, ':COST')
CROSS JOIN _external_context
ON CONFLICT ("financeEntryId", "lineNo") DO UPDATE SET
  "lineTotal" = EXCLUDED."lineTotal", "unitCost" = EXCLUDED."unitCost",
  "landedUnitCost" = EXCLUDED."landedUnitCost";

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "accountId", "partyId",
  "paymentMethod", "settlesId", "importKey", description, reference,
  "branchId", "orderId", "createdById", "createdAt"
)
SELECT concat('ext-courier-payment-', lower(source.source_key)), source.placed_at,
  'PAYMENT_OUT', source.fee, 'IQD', false, context.cash_account_id, courier.id,
  'CASH', fee.id, concat('EXTREP:20260812:COURIER:', source.source_key, ':PAID'),
  'Courier fee paid in advance', source.tracking, orders."branchId", orders.id,
  context.actor_id, CURRENT_TIMESTAMP
FROM _direct_courier_fee source
JOIN "Order" orders ON orders.id = source.order_id
JOIN "Party" courier ON courier."externalKey" = source.courier_key
JOIN "FinanceEntry" fee ON fee."importKey" = concat('SHIP:', orders.id, ':COST')
CROSS JOIN _external_context context
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "accountId" = EXCLUDED."accountId",
  "settlesId" = EXCLUDED."settlesId", "archivedAt" = NULL, "archiveReason" = NULL;

-- The paid-online 688 order remains operationally pending. Its Hi-Express fee
-- was nevertheless paid in advance, so close the existing fee obligation.
INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "accountId", "partyId",
  "paymentMethod", "settlesId", "importKey", description, reference,
  "branchId", "orderId", "createdById", "createdAt"
)
SELECT 'ext-payment-688-courier', '2026-08-10 12:59:15.572', 'PAYMENT_OUT',
  fee.amount, 'IQD', false, context.cash_account_id, provider.id, 'CASH', fee.id,
  'EXTREP:20260812:688:COURIER', 'Hi-Express fee paid in advance',
  'KRG2451786395412', orders."branchId", orders.id, context.actor_id, CURRENT_TIMESTAMP
FROM "Order" orders
JOIN "FinanceEntry" fee ON fee.id = 'finance-shipment-wayl-688e6c1g-cost'
JOIN "Party" provider ON provider."externalKey" = 'HI_EXPRESS'
CROSS JOIN _external_context context
WHERE orders.id = 'correction-order-wayl-688e6c1g'
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "accountId" = EXCLUDED."accountId",
  "settlesId" = EXCLUDED."settlesId", "archivedAt" = NULL, "archiveReason" = NULL;

-- Five IQD 25,000 shipments are inventory-transfer freight, not customer
-- orders. The approved treatment offsets the freight payable against an
-- existing Hi-Express receivable and leaves no cash or revenue impact.
CREATE TEMP TABLE _inventory_freight (
  line_no integer PRIMARY KEY,
  tracking text NOT NULL,
  recipient text NOT NULL,
  destination text NOT NULL,
  amount integer NOT NULL
) ON COMMIT DROP;

INSERT INTO _inventory_freight VALUES
  (1,'KRG6371785600607','Ibrahim','Storix fulfillment center',25000),
  (2,'KRG9081785600710','Ibrahim','Storix fulfillment center',25000),
  (3,'KRG5631785600783','Ibrahim','Storix fulfillment center',25000),
  (4,'KRG7671785600927','Ibrahim','Storix fulfillment center',25000),
  (5,'KRG2981785601067','Aws Aktham','Core Business sales point',25000);

INSERT INTO "FinanceEntry" (
  id, "recordKey", date, type, "recordClass", amount, currency, obligation,
  "obligationKind", "partyId", "categoryType", "importKey", description,
  reference, "branchId", "createdById", "createdAt"
)
SELECT 'ext-inventory-freight-parent', 'EXTDOC-20260812-HI-FREIGHT',
  '2026-08-01 23:59:59', 'PURCHASE', 'PURCHASE', 125000, 'IQD', true,
  'PAYABLE', provider.id, 'SHIPPING', 'EXTREP:20260812:HI:FREIGHT:AP',
  'Bulk inventory-transfer freight to Storix and Core Business',
  'KRG637/KRG908/KRG563/KRG767/KRG298', context.branch_id,
  context.actor_id, CURRENT_TIMESTAMP
FROM "Party" provider CROSS JOIN _external_context context
WHERE provider."externalKey" = 'HI_EXPRESS'
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "partyId" = EXCLUDED."partyId",
  "archivedAt" = NULL, "archiveReason" = NULL;

INSERT INTO "LedgerEntryLine" (
  id, "financeEntryId", "lineNo", "itemType", "itemName", "categoryType",
  unit, quantity, "unitCost", "landedUnitCost", "lineTotal", "branchId", notes,
  "spendTreatment", "classificationStatus", "classificationSource",
  "classificationNote"
)
SELECT concat('ext-inventory-freight-line-', source.line_no), parent.id,
  source.line_no, 'SERVICE', 'Inventory transfer freight', 'SHIPPING', 'shipment',
  1, source.amount, source.amount, source.amount, context.branch_id,
  concat(source.tracking, ' - ', source.recipient, ' - ', source.destination),
  'INVENTORY', 'NEEDS_REVIEW', 'approved-external-report-2026-08-12',
  'Inventory quantities are intentionally not fabricated; allocate to stock items when the transfer manifest is available.'
FROM _inventory_freight source
JOIN "FinanceEntry" parent ON parent."importKey" = 'EXTREP:20260812:HI:FREIGHT:AP'
CROSS JOIN _external_context context
ON CONFLICT ("financeEntryId", "lineNo") DO UPDATE SET
  "lineTotal" = EXCLUDED."lineTotal", "unitCost" = EXCLUDED."unitCost",
  "landedUnitCost" = EXCLUDED."landedUnitCost", notes = EXCLUDED.notes;

INSERT INTO "InventoryLandedCostAllocation" (
  id, "importKey", "financeEntryId", "ledgerLineId", amount, notes, "createdAt"
)
SELECT concat('ext-inventory-freight-allocation-', source.line_no),
  concat('EXTREP:20260812:HI:FREIGHT:ALLOC:', source.line_no), parent.id, line.id,
  source.amount,
  concat(source.tracking, ': transfer freight awaiting item-level manifest linkage.'),
  CURRENT_TIMESTAMP
FROM _inventory_freight source
JOIN "FinanceEntry" parent ON parent."importKey" = 'EXTREP:20260812:HI:FREIGHT:AP'
JOIN "LedgerEntryLine" line ON line."financeEntryId" = parent.id AND line."lineNo" = source.line_no
CROSS JOIN _external_context
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "ledgerLineId" = EXCLUDED."ledgerLineId", notes = EXCLUDED.notes;

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "obligationKind", "partyId",
  "importKey", description, reference, "branchId", "createdById", "createdAt"
)
SELECT 'ext-inventory-freight-receivable', '2026-08-01 23:59:59', 'INCOME',
  125000, 'IQD', true, 'RECEIVABLE', provider.id,
  'EXTREP:20260812:HI:FREIGHT:AR',
  'Owner-approved opening Hi-Express credit applied to inventory-transfer freight',
  'Inventory freight offset', context.branch_id, context.actor_id, CURRENT_TIMESTAMP
FROM "Party" provider CROSS JOIN _external_context context
WHERE provider."externalKey" = 'HI_EXPRESS'
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "partyId" = EXCLUDED."partyId",
  "archivedAt" = NULL, "archiveReason" = NULL;

INSERT INTO "ProviderSettlement" (
  id, "providerPartyId", "accountId", date, "grossCleared", "feesOffset",
  "amountReceived", "paymentMethod", reference, "createdById", "createdAt"
)
SELECT 'ext-hi-freight-settlement', provider.id, context.cash_account_id,
  '2026-08-01 23:59:59', 125000, 125000, 0, 'OFFSET',
  'EXTREP-20260812-HI-FREIGHT', context.actor_id, CURRENT_TIMESTAMP
FROM "Party" provider CROSS JOIN _external_context context
WHERE provider."externalKey" = 'HI_EXPRESS'
ON CONFLICT (reference) DO UPDATE SET
  "grossCleared" = EXCLUDED."grossCleared",
  "feesOffset" = EXCLUDED."feesOffset",
  "amountReceived" = EXCLUDED."amountReceived";

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "partyId", "paymentMethod",
  "settlesId", "importKey", description, "branchId", "createdById",
  "providerSettlementId", "createdAt"
)
SELECT 'ext-inventory-freight-offset-in', '2026-08-01 23:59:59', 'PAYMENT_IN',
  125000, 'IQD', false, provider.id, 'OFFSET', receivable.id,
  'EXTREP:20260812:HI:FREIGHT:OFFSET:IN',
  'Hi-Express balance offset against inventory freight', context.branch_id,
  context.actor_id, settlement.id, CURRENT_TIMESTAMP
FROM "Party" provider
JOIN "FinanceEntry" receivable ON receivable."importKey" = 'EXTREP:20260812:HI:FREIGHT:AR'
JOIN "ProviderSettlement" settlement ON settlement.reference = 'EXTREP-20260812-HI-FREIGHT'
CROSS JOIN _external_context context
WHERE provider."externalKey" = 'HI_EXPRESS'
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "settlesId" = EXCLUDED."settlesId",
  "providerSettlementId" = EXCLUDED."providerSettlementId",
  "archivedAt" = NULL, "archiveReason" = NULL;

INSERT INTO "FinanceEntry" (
  id, date, type, amount, currency, obligation, "partyId", "paymentMethod",
  "settlesId", "importKey", description, "branchId", "createdById",
  "providerSettlementId", "createdAt"
)
SELECT 'ext-inventory-freight-offset-out', '2026-08-01 23:59:59', 'PAYMENT_OUT',
  125000, 'IQD', false, provider.id, 'OFFSET', payable.id,
  'EXTREP:20260812:HI:FREIGHT:OFFSET:OUT',
  'Inventory freight settled against Hi-Express balance', context.branch_id,
  context.actor_id, settlement.id, CURRENT_TIMESTAMP
FROM "Party" provider
JOIN "FinanceEntry" payable ON payable."importKey" = 'EXTREP:20260812:HI:FREIGHT:AP'
JOIN "ProviderSettlement" settlement ON settlement.reference = 'EXTREP-20260812-HI-FREIGHT'
CROSS JOIN _external_context context
WHERE provider."externalKey" = 'HI_EXPRESS'
ON CONFLICT ("importKey") DO UPDATE SET
  amount = EXCLUDED.amount, "settlesId" = EXCLUDED."settlesId",
  "providerSettlementId" = EXCLUDED."providerSettlementId",
  "archivedAt" = NULL, "archiveReason" = NULL;

-- Refresh cached customer metrics from the same sale-status contract used by
-- dashboards. Pending external orders remain outside these statistics.
UPDATE "Customer" customer
SET
  "ordersCount" = stats.order_count,
  "firstOrderAt" = stats.first_order,
  "lastOrderAt" = stats.last_order
FROM (
  SELECT
    customer_source.id,
    count(sale_order.id)::integer AS order_count,
    min(sale_order."placedAt") AS first_order,
    max(sale_order."placedAt") AS last_order
  FROM "Customer" customer_source
  LEFT JOIN (
    SELECT orders.*
    FROM "Order" orders
    LEFT JOIN "ListOption" status_role
      ON status_role."listKey" = 'orderStatus' AND status_role.code = orders.status
    WHERE COALESCE(
      status_role."metricRole",
      CASE WHEN orders.status = 'COMPLETED' THEN 'SALE' ELSE 'UNKNOWN' END
    ) = 'SALE'
      AND orders.purpose = 'SALE'
  ) sale_order ON sale_order."customerId" = customer_source.id
  GROUP BY customer_source.id
) stats
WHERE customer.id = stats.id
  AND EXISTS (SELECT 1 FROM _external_context);

-- Snapshot the corrected canonical metrics at the transaction timestamp. The
-- values are calculated, not hard-coded, so future activity cannot make the
-- migration publish stale integrity targets.
CREATE TEMP TABLE _external_metrics ON COMMIT DROP AS
WITH active_spend AS (
  SELECT line."lineTotal", line."spendTreatment"
  FROM "LedgerEntryLine" line
  JOIN "FinanceEntry" entry ON entry.id = line."financeEntryId"
  WHERE entry.type IN ('EXPENSE', 'PURCHASE')
    AND entry."archivedAt" IS NULL
    AND entry."reversedAt" IS NULL
    AND entry."reversalOfId" IS NULL
), sale_orders AS (
  SELECT orders.*
  FROM "Order" orders
  LEFT JOIN "ListOption" status_role
    ON status_role."listKey" = 'orderStatus' AND status_role.code = orders.status
  WHERE COALESCE(
    status_role."metricRole",
    CASE WHEN orders.status = 'COMPLETED' THEN 'SALE' ELSE 'UNKNOWN' END
  ) = 'SALE'
), spend AS (
  SELECT
    COALESCE(SUM("lineTotal"), 0)::bigint AS total_spending,
    COALESCE(SUM("lineTotal") FILTER (WHERE "spendTreatment" = 'CAPEX'), 0)::bigint AS capex,
    COALESCE(SUM("lineTotal") FILTER (WHERE "spendTreatment" = 'INVENTORY'), 0)::bigint AS inventory,
    COALESCE(SUM("lineTotal") FILTER (WHERE "spendTreatment" IN ('OPEX', 'REVIEW')), 0)::bigint AS operating
  FROM active_spend
), sales AS (
  SELECT
    COALESCE(SUM(GREATEST(
      "grossAmount" - "discountAmount" - "refundAmount" + "deliveryFee" + "extraCharges",
      0
    )) FILTER (WHERE purpose = 'SALE'), 0)::bigint AS sales,
    COUNT(*) FILTER (WHERE purpose = 'SALE')::bigint AS sale_orders,
    COUNT(*) FILTER (WHERE purpose = 'PROMOTION')::bigint AS promotion_orders
  FROM sale_orders
)
SELECT spend.*, sales.*, CURRENT_TIMESTAMP AS cutoff
FROM spend CROSS JOIN sales
WHERE EXISTS (SELECT 1 FROM _external_context);

INSERT INTO "Setting" (key, value, "updatedAt")
SELECT setting.key, setting.value, CURRENT_TIMESTAMP
FROM _external_metrics metrics
CROSS JOIN LATERAL (
  VALUES
    ('finance_integrity_expected_total_spending', metrics.total_spending::text),
    ('finance_integrity_expected_capex', metrics.capex::text),
    ('finance_integrity_expected_inventory', metrics.inventory::text),
    ('finance_integrity_expected_operating', metrics.operating::text),
    ('finance_integrity_expected_sales', metrics.sales::text),
    ('finance_integrity_expected_sale_orders', metrics.sale_orders::text),
    ('finance_integrity_expected_promotion_orders', metrics.promotion_orders::text),
    ('finance_integrity_expected_cutoff', metrics.cutoff::text),
    ('finance_integrity_correction_version', '2026-08-12-v1'),
    ('wayl_statement_gross', '402000'),
    ('wayl_statement_commission', '24266'),
    ('wayl_statement_payouts', '362894'),
    ('wayl_statement_wallet_balance', '14840')
) setting(key, value)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  "updatedAt" = CURRENT_TIMESTAMP;

-- Abort the entire transaction unless the imported source, order/payment
-- contracts, provider balances, spending equation, and accounting links agree.
DO $$
DECLARE
  failures integer;
  numeric_value bigint;
  failure_details text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _external_context) THEN RETURN; END IF;

  SELECT count(*) INTO failures
  FROM _external_orders source
  LEFT JOIN "Order" orders ON orders.id = source.id
  LEFT JOIN "Customer" customer ON customer.id = orders."customerId"
  LEFT JOIN "Shipment" shipment ON shipment."orderId" = orders.id
  WHERE orders.id IS NULL OR customer.id IS NULL OR shipment.id IS NULL
    OR orders.status IS DISTINCT FROM source.status
    OR orders."grossAmount" IS DISTINCT FROM source.gross_amount
    OR orders."discountAmount" IS DISTINCT FROM source.discount_amount
    OR orders."deliveryFee" IS DISTINCT FROM source.delivery_fee
    OR orders."deliveryCost" IS DISTINCT FROM source.delivery_cost
    OR shipment.status IS DISTINCT FROM source.shipment_status
    OR shipment."shippingCost" IS DISTINCT FROM source.delivery_cost;
  IF failures <> 0 THEN
    RAISE EXCEPTION 'External order, customer, or shipment reconciliation failures: %', failures;
  END IF;

  IF (SELECT count(*) FROM _external_orders) <> 26
    OR (SELECT count(*) FROM _external_orders WHERE status = 'COMPLETED') <> 20
    OR (SELECT count(*) FROM _external_orders WHERE status = 'PENDING') <> 6
    OR (SELECT count(*) FROM "Order" WHERE id LIKE 'ext-order-%') <> 26 THEN
    RAISE EXCEPTION 'External order snapshot count changed';
  END IF;

  SELECT count(*) INTO failures
  FROM _external_orders source
  JOIN "Order" orders ON orders.id = source.id
  WHERE source.status = 'PENDING'
    AND (
      EXISTS (
        SELECT 1 FROM "FinanceEntry" entry
        WHERE entry."orderId" = orders.id
          AND entry."archivedAt" IS NULL
          AND entry."reversedAt" IS NULL
          AND entry."reversalOfId" IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM "StockMovement" movement
        WHERE movement."orderId" = orders.id AND movement.reason = 'SOLD'
      )
    );
  IF failures <> 0 THEN
    RAISE EXCEPTION 'Pending external orders generated finance or sold stock: %', failures;
  END IF;

  SELECT count(*) INTO failures
  FROM _external_orders source
  JOIN "Order" orders ON orders.id = source.id
  LEFT JOIN "FinanceEntry" receivable
    ON receivable."importKey" = concat('ORD:', orders.id, ':PROVIDER')
    AND receivable."archivedAt" IS NULL
    AND receivable."reversedAt" IS NULL
    AND receivable."reversalOfId" IS NULL
  LEFT JOIN "Party" provider ON provider.id = receivable."partyId"
  WHERE source.status = 'COMPLETED'
    AND (
      receivable.id IS NULL
      OR receivable.amount <> source.gross_amount - source.discount_amount + source.delivery_fee
      OR provider."externalKey" IS DISTINCT FROM source.payment_route
    );
  IF failures <> 0 THEN
    SELECT concat(
      source.source_key, ':',
      COALESCE(receivable."importKey", 'missing'), ':',
      COALESCE(receivable.amount::text, 'missing'), ':',
      COALESCE(provider."externalKey", 'missing'), ':expected=', source.payment_route,
      ':expectedAmount=', source.gross_amount - source.discount_amount + source.delivery_fee
    ) INTO failure_details
    FROM _external_orders source
    JOIN "Order" orders ON orders.id = source.id
    LEFT JOIN "FinanceEntry" receivable
      ON receivable."importKey" = concat('ORD:', orders.id, ':PROVIDER')
      AND receivable."archivedAt" IS NULL
      AND receivable."reversedAt" IS NULL
      AND receivable."reversalOfId" IS NULL
    LEFT JOIN "Party" provider ON provider.id = receivable."partyId"
    WHERE source.status = 'COMPLETED'
      AND (
        receivable.id IS NULL
        OR receivable.amount <> source.gross_amount - source.discount_amount + source.delivery_fee
        OR provider."externalKey" IS DISTINCT FROM source.payment_route
      )
    ORDER BY source.source_key
    LIMIT 1;
    RAISE EXCEPTION 'Completed external invoices lack one canonical provider collection: % [%]', failures, failure_details;
  END IF;

  SELECT count(*) INTO failures
  FROM _external_orders source
  JOIN "Order" orders ON orders.id = source.id
  LEFT JOIN "FinanceEntry" fee
    ON fee."importKey" = concat('SHIP:', orders.id, ':COST')
    AND fee."archivedAt" IS NULL
    AND fee."reversedAt" IS NULL
    AND fee."reversalOfId" IS NULL
  WHERE source.status = 'COMPLETED'
    AND source.delivery_cost > 0
    AND (fee.id IS NULL OR fee.amount <> source.delivery_cost OR fee."costRole" <> 'DIRECT_DELIVERY');
  IF failures <> 0 THEN
    RAISE EXCEPTION 'Completed external orders lack canonical courier cost: %', failures;
  END IF;

  WITH active_finance AS (
    SELECT * FROM "FinanceEntry"
    WHERE "archivedAt" IS NULL AND "reversedAt" IS NULL AND "reversalOfId" IS NULL
  ), balances AS (
    SELECT obligation.id, obligation.amount - COALESCE(SUM(settlement.amount), 0)::integer AS outstanding
    FROM active_finance obligation
    LEFT JOIN active_finance settlement ON settlement."settlesId" = obligation.id
    WHERE obligation.obligation = true
    GROUP BY obligation.id, obligation.amount
  )
  SELECT count(*) INTO failures FROM balances WHERE outstanding < 0;
  IF failures <> 0 THEN
    RAISE EXCEPTION 'Over-settled obligations after reconciliation: %', failures;
  END IF;

  WITH active_finance AS (
    SELECT * FROM "FinanceEntry"
    WHERE "archivedAt" IS NULL AND "reversedAt" IS NULL AND "reversalOfId" IS NULL
  ), hi_balances AS (
    SELECT source.order_id,
      receivable.amount - COALESCE(SUM(settlement.amount), 0)::integer AS outstanding
    FROM _hi_settlement_source source
    JOIN active_finance receivable
      ON receivable."importKey" = concat('ORD:', source.order_id, ':PROVIDER')
    LEFT JOIN active_finance settlement ON settlement."settlesId" = receivable.id
    GROUP BY source.order_id, receivable.amount
  )
  SELECT count(*) INTO failures FROM hi_balances WHERE outstanding <> 0;
  IF failures <> 0 THEN
    RAISE EXCEPTION 'Hi-Express remittances are not fully settled: %', failures;
  END IF;

  IF (SELECT count(*) FROM _hi_settlement_source) <> 10
    OR (SELECT sum(gross) FROM _hi_settlement_source) <> 274500
    OR (SELECT sum(fee) FROM _hi_settlement_source) <> 51000
    OR (SELECT sum("grossCleared") FROM "ProviderSettlement" settlement JOIN _hi_settlement_source source ON settlement.reference = concat('EXTREP-20260812-HI-', source.source_key)) <> 274500
    OR (SELECT sum("feesOffset") FROM "ProviderSettlement" settlement JOIN _hi_settlement_source source ON settlement.reference = concat('EXTREP-20260812-HI-', source.source_key)) <> 51000
    OR (SELECT sum("amountReceived") FROM "ProviderSettlement" settlement JOIN _hi_settlement_source source ON settlement.reference = concat('EXTREP-20260812-HI-', source.source_key)) <> 223500 THEN
    RAISE EXCEPTION 'Hi-Express source totals changed';
  END IF;

  WITH active_finance AS (
    SELECT * FROM "FinanceEntry"
    WHERE "archivedAt" IS NULL AND "reversedAt" IS NULL AND "reversalOfId" IS NULL
  )
  SELECT COALESCE(SUM(receivable.amount - COALESCE(settled.amount, 0)), 0)
  INTO numeric_value
  FROM _storix_source source
  JOIN active_finance receivable
    ON receivable."importKey" = concat('ORD:', source.order_id, ':PROVIDER')
  LEFT JOIN LATERAL (
    SELECT SUM(payment.amount)::integer AS amount
    FROM active_finance payment WHERE payment."settlesId" = receivable.id
  ) settled ON true;
  IF (SELECT count(*) FROM _storix_source) <> 5
    OR (SELECT sum(gross) FROM _storix_source) <> 95500
    OR (SELECT sum(fee) FROM _storix_source) <> 25000
    OR numeric_value <> 70500 THEN
    RAISE EXCEPTION 'Storix provider balance is %, expected 70500', numeric_value;
  END IF;

  IF (SELECT count(*) FROM "PaymentReconciliationItem" item JOIN "Party" provider ON provider.id = item."providerPartyId" WHERE provider."externalKey" = 'WAYL') <> 17
    OR (SELECT sum(item."grossAmount") FROM "PaymentReconciliationItem" item JOIN "Party" provider ON provider.id = item."providerPartyId" WHERE provider."externalKey" = 'WAYL') <> 402000
    OR (SELECT sum(item."feeAmount") FROM "PaymentReconciliationItem" item JOIN "Party" provider ON provider.id = item."providerPartyId" WHERE provider."externalKey" = 'WAYL') <> 24266
    OR (SELECT sum(amount) FROM "FinanceEntry" WHERE "importKey" LIKE 'WAYL:PAYOUT:REF:%' AND "archivedAt" IS NULL) <> 362894 THEN
    RAISE EXCEPTION 'Wayl statement totals changed';
  END IF;

  SELECT account."openingBalance" + COALESCE(SUM(
    CASE
      WHEN entry."accountId" = account.id THEN
        CASE
          WHEN entry.type IN ('INCOME', 'PAYMENT_IN', 'CAPITAL_IN') THEN entry.amount
          WHEN entry.type IN ('EXPENSE', 'PURCHASE', 'PAYMENT_OUT', 'DRAWING', 'TRANSFER') THEN -entry.amount
          ELSE 0
        END
      WHEN entry."toAccountId" = account.id AND entry.type = 'TRANSFER' THEN entry.amount
      ELSE 0
    END
  ), 0) INTO numeric_value
  FROM "FinanceAccount" account
  LEFT JOIN "FinanceEntry" entry
    ON (entry."accountId" = account.id OR entry."toAccountId" = account.id)
    AND entry.obligation = false
    AND entry."archivedAt" IS NULL
    AND entry."reversedAt" IS NULL
    AND entry."reversalOfId" IS NULL
  WHERE account."externalKey" = 'WAYL_WALLET'
  GROUP BY account.id;
  IF numeric_value <> 14840 THEN
    RAISE EXCEPTION 'Wayl wallet is %, expected 14840', numeric_value;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "Order" orders
    JOIN "FinanceEntry" receivable
      ON receivable."importKey" = concat('ORD:', orders.id, ':PROVIDER')
      AND receivable.amount = 16000
      AND receivable."archivedAt" IS NULL
    JOIN "FinanceEntry" receipt
      ON receipt."settlesId" = receivable.id
      AND receipt."importKey" = 'WAYL:STATEMENT:688E6C1G:GROSS'
      AND receipt.amount = 16000
      AND receipt."archivedAt" IS NULL
    WHERE orders.id = 'correction-order-wayl-688e6c1g'
      AND orders.status = 'PENDING'
      AND NOT EXISTS (
        SELECT 1 FROM "StockMovement" movement
        WHERE movement."orderId" = orders.id AND movement.reason = 'SOLD'
      )
  ) THEN
    RAISE EXCEPTION 'Paid-online 688 review order lost its pending/payment contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "FinanceEntry" payable
    JOIN "FinanceEntry" receivable ON receivable."importKey" = 'EXTREP:20260812:HI:FREIGHT:AR'
    JOIN "ProviderSettlement" settlement ON settlement.reference = 'EXTREP-20260812-HI-FREIGHT'
    WHERE payable."importKey" = 'EXTREP:20260812:HI:FREIGHT:AP'
      AND payable.amount = 125000 AND receivable.amount = 125000
      AND settlement."grossCleared" = 125000
      AND settlement."feesOffset" = 125000
      AND settlement."amountReceived" = 0
      AND (SELECT COALESCE(SUM(amount), 0) FROM "InventoryLandedCostAllocation" allocation WHERE allocation."financeEntryId" = payable.id) = 125000
      AND (SELECT COALESCE(SUM(amount), 0) FROM "FinanceEntry" payment WHERE payment."settlesId" = payable.id AND payment."archivedAt" IS NULL) = 125000
      AND (SELECT COALESCE(SUM(amount), 0) FROM "FinanceEntry" payment WHERE payment."settlesId" = receivable.id AND payment."archivedAt" IS NULL) = 125000
  ) THEN
    RAISE EXCEPTION 'Inventory-transfer freight does not reconcile to 125000';
  END IF;

  SELECT count(*) INTO failures
  FROM "ProviderSettlement" settlement
  WHERE settlement."grossCleared" <> settlement."feesOffset" + settlement."amountReceived";
  IF failures <> 0 THEN
    RAISE EXCEPTION 'Provider settlement arithmetic failures: %', failures;
  END IF;

  SELECT count(*) INTO failures
  FROM "FinanceEntry" entry
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(line."lineTotal"), 0)::integer AS total
    FROM "LedgerEntryLine" line WHERE line."financeEntryId" = entry.id
  ) lines ON true
  WHERE entry.type IN ('EXPENSE', 'PURCHASE')
    AND entry."archivedAt" IS NULL
    AND entry."reversedAt" IS NULL
    AND entry."reversalOfId" IS NULL
    AND (lines.total <> entry.amount OR NOT EXISTS (
      SELECT 1 FROM "LedgerEntryLine" line WHERE line."financeEntryId" = entry.id
    ));
  IF failures <> 0 THEN
    RAISE EXCEPTION 'Active spending parents do not equal their ledger lines: %', failures;
  END IF;

  IF EXISTS (
    SELECT 1 FROM _external_metrics
    WHERE total_spending <> capex + inventory + operating
  ) THEN
    RAISE EXCEPTION 'Canonical spending equation is not balanced';
  END IF;

  SELECT count(*) INTO failures
  FROM "Customer" customer
  LEFT JOIN (
    SELECT orders."customerId", count(*)::integer AS order_count,
      min(orders."placedAt") AS first_order, max(orders."placedAt") AS last_order
    FROM "Order" orders
    LEFT JOIN "ListOption" status_role
      ON status_role."listKey" = 'orderStatus' AND status_role.code = orders.status
    WHERE COALESCE(status_role."metricRole", CASE WHEN orders.status = 'COMPLETED' THEN 'SALE' END) = 'SALE'
      AND orders.purpose = 'SALE' AND orders."customerId" IS NOT NULL
    GROUP BY orders."customerId"
  ) actual ON actual."customerId" = customer.id
  WHERE customer."ordersCount" <> COALESCE(actual.order_count, 0)
    OR customer."firstOrderAt" IS DISTINCT FROM actual.first_order
    OR customer."lastOrderAt" IS DISTINCT FROM actual.last_order;
  IF failures <> 0 THEN
    RAISE EXCEPTION 'Customer cached statistics failures: %', failures;
  END IF;
END $$;

INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", metadata, "createdAt")
SELECT
  'audit-external-reports-reconciliation-20260812-v1',
  context.actor_id,
  'EXTERNAL_REPORT_RECONCILIATION',
  'Finance',
  '2026-08-12-v1',
  jsonb_build_object(
    'sources', jsonb_build_array(
      'prime express report.pdf', 'Storix fullfillments Report.xlsx.xls',
      'HiExpress Report.xlsx', 'Wayle transactions report.csv',
      'Orders throgh Wayle report.csv'
    ),
    'approvedDecisionMode', 'one-by-one',
    'ordersCreated', 26,
    'completedOrders', 20,
    'pendingUnpaidOrders', 6,
    'wayl', jsonb_build_object('gross', 402000, 'commission', 24266, 'payouts', 362894, 'wallet', 14840),
    'hiExpress', jsonb_build_object('grossCleared', 274500, 'fees', 51000, 'cashReceived', 223500),
    'storix', jsonb_build_object('grossCollected', 95500, 'feesOffset', 25000, 'netReceivable', 70500),
    'inventoryFreight', jsonb_build_object(
      'amount', 125000,
      'basis', 'owner-approved opening Hi-Express credit',
      'shipments', 5,
      'itemManifestPending', true
    ),
    'spendingSnapshot', jsonb_build_object(
      'total', metrics.total_spending,
      'capex', metrics.capex,
      'inventory', metrics.inventory,
      'operating', metrics.operating
    ),
    'salesSnapshot', jsonb_build_object(
      'sales', metrics.sales,
      'saleOrders', metrics.sale_orders,
      'promotionOrders', metrics.promotion_orders
    ),
    'cutoff', metrics.cutoff,
    'idempotentKey', 'external_reports_reconciliation_version=2026-08-12-v1'
  ),
  CURRENT_TIMESTAMP
FROM _external_context context CROSS JOIN _external_metrics metrics
ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata;

-- This marker is intentionally last. If any assertion above fails, the full
-- transaction rolls back and production remains untouched.
INSERT INTO "Setting" (key, value, "updatedAt")
SELECT 'external_reports_reconciliation_version', '2026-08-12-v1', CURRENT_TIMESTAMP
FROM _external_context
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = CURRENT_TIMESTAMP;

COMMIT;
