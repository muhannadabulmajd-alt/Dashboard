import { PrismaClient } from '@prisma/client';
import { buildShareholderReportData } from '../src/server/reports/shareholder-data';
import { isValidRetailBarcode } from '../src/lib/barcode';
import { groupInvoiceFinanceEntries, invoicePaymentSnapshot } from '../src/lib/invoice';

const prisma = new PrismaClient();

type CountRow = { count: bigint | number };

async function count(sql: TemplateStringsArray): Promise<number> {
  const rows = await prisma.$queryRaw<CountRow[]>(sql);
  return Number(rows[0]?.count ?? 0);
}

async function main(): Promise<void> {
  const checks: { name: string; failures: number }[] = [];

  checks.push({
    name: 'multi-line parent totals',
    failures: await count`
      SELECT COUNT(*) AS count FROM (
        SELECT e.id
        FROM "FinanceEntry" e
        JOIN "LedgerEntryLine" l ON l."financeEntryId" = e.id
        GROUP BY e.id, e.amount
        HAVING SUM(l."lineTotal") <> e.amount
      ) mismatches
    `,
  });

  const report = await buildShareholderReportData({ db: prisma });
  for (const result of report.checks) {
    if (result.status === 'WARNING') continue;
    checks.push({
      name: `shareholder report: ${result.key}`,
      failures: result.status === 'PASS' ? 0 : result.affectedRecords.length || 1,
    });
  }

  console.log(`SNAPSHOT shareholder report: ${report.snapshotHash}`);
  console.log(`BASELINE ${JSON.stringify(report.baseline)}`);

  checks.push({
    name: 'ledger record classifications',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "FinanceEntry" e
      WHERE e.type IN ('EXPENSE', 'PURCHASE')
        AND e."recordClass" IS DISTINCT FROM CASE
          WHEN e.type = 'EXPENSE' THEN 'EXPENSE'::"LedgerRecordClass"
          WHEN EXISTS (
            SELECT 1 FROM "LedgerEntryLine" l
            WHERE l."financeEntryId" = e.id AND l."itemType" IN ('INVENTORY', 'ASSET')
          ) AND EXISTS (
            SELECT 1 FROM "LedgerEntryLine" l
            WHERE l."financeEntryId" = e.id AND l."itemType" IN ('EXPENSE', 'SERVICE', 'OTHER')
          ) THEN 'MIXED'::"LedgerRecordClass"
          WHEN EXISTS (
            SELECT 1 FROM "LedgerEntryLine" l
            WHERE l."financeEntryId" = e.id AND l."itemType" IN ('EXPENSE', 'SERVICE', 'OTHER')
          ) THEN 'EXPENSE'::"LedgerRecordClass"
          ELSE 'PURCHASE'::"LedgerRecordClass"
        END
    `,
  });

  checks.push({
    name: 'classified purchase allocation',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "FinanceEntry" e
      WHERE e.type = 'PURCHASE'
        AND e."archivedAt" IS NULL
        AND e."reversedAt" IS NULL
        AND e."reversalOfId" IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM "LedgerEntryLine" l
            WHERE l."financeEntryId" = e.id
              AND l."itemType" NOT IN ('INVENTORY', 'ASSET', 'EXPENSE', 'SERVICE', 'OTHER')
          )
          OR (
            NOT EXISTS (SELECT 1 FROM "LedgerEntryLine" l WHERE l."financeEntryId" = e.id)
            AND NOT EXISTS (SELECT 1 FROM "FixedAsset" a WHERE a."financeEntryId" = e.id)
            AND NOT EXISTS (SELECT 1 FROM "InventoryCostLayer" c WHERE c."financeEntryId" = e.id)
            AND e."categoryType" IN ('GREEN_COFFEE', 'PACKAGING', 'EQUIPMENT')
          )
        )
    `,
  });

  checks.push({
    name: 'mapped order metric statuses',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "Order" o
      LEFT JOIN "ListOption" status_role
        ON status_role."listKey" = 'orderStatus' AND status_role.code = o.status
      WHERE COALESCE(
        status_role."metricRole",
        CASE
          WHEN o.status = 'PENDING' THEN 'OPEN'
          WHEN o.status = 'COMPLETED' THEN 'SALE'
          WHEN o.status IN ('RETURNED', 'REFUNDED') THEN 'RETURN'
          WHEN o.status IN ('CANCELLED', 'CANCELED') THEN 'CANCELED'
        END
      ) IS NULL
    `,
  });

  const [orders, orderFinanceEntries, orderStatusOptions, activeProducts, paymentInvariantSetting] = await Promise.all([
    prisma.order.findMany({
      select: {
        id: true,
        createdAt: true,
        status: true,
        grossAmount: true,
        discountAmount: true,
        refundAmount: true,
        deliveryFee: true,
        extraCharges: true,
      },
    }),
    prisma.financeEntry.findMany({
      select: {
        id: true,
        orderId: true,
        type: true,
        amount: true,
        obligation: true,
        obligationKind: true,
        settlesId: true,
        archivedAt: true,
        reversedAt: true,
        reversalOfId: true,
        date: true,
        paymentMethod: true,
        account: { select: { name: true } },
        party: { select: { id: true, name: true, collectsOrderPayments: true } },
      },
    }),
    prisma.listOption.findMany({
      where: { listKey: 'orderStatus' },
      select: { code: true, metricRole: true },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, retailBarcode: true },
    }),
    prisma.setting.findUnique({
      where: { key: 'order_payment_invariant_started_at' },
      select: { value: true },
    }),
  ]);
  const parsedPaymentInvariantStart = paymentInvariantSetting
    ? new Date(paymentInvariantSetting.value)
    : null;
  const paymentInvariantStartedAt =
    parsedPaymentInvariantStart && !Number.isNaN(parsedPaymentInvariantStart.getTime())
      ? parsedPaymentInvariantStart
      : null;
  const statusRoles = new Map(orderStatusOptions.map((option) => [option.code, option.metricRole]));
  const fallbackRole = (status: string) => {
    if (status === 'COMPLETED') return 'SALE';
    if (status === 'PENDING') return 'OPEN';
    if (status === 'RETURNED' || status === 'REFUNDED') return 'RETURN';
    if (status === 'CANCELLED' || status === 'CANCELED') return 'CANCELED';
    return 'UNKNOWN';
  };
  const roleFor = (status: string) => statusRoles.get(status) ?? fallbackRole(status);
  const entriesByOrder = groupInvoiceFinanceEntries(orderFinanceEntries);
  const orderSnapshots = orders.map((order) => ({
    order,
    role: roleFor(order.status),
    payment: invoicePaymentSnapshot(order, entriesByOrder.get(order.id) ?? []),
  }));
  const unpaidCompletedOrders = orderSnapshots.filter(
    ({ role, payment }) => role === 'SALE' && (payment.status !== 'PAID' || payment.remaining !== 0),
  );
  const legacyUnpaidCompletedOrders = paymentInvariantStartedAt
    ? unpaidCompletedOrders.filter(({ order }) => order.createdAt < paymentInvariantStartedAt)
    : [];
  console.log(
    `WARN legacy completed invoices predating payment enforcement: ${legacyUnpaidCompletedOrders.length}`,
  );
  checks.push({
    name: 'completed order invoices fully paid',
    failures: unpaidCompletedOrders.filter(
      ({ order }) => !paymentInvariantStartedAt || order.createdAt >= paymentInvariantStartedAt,
    ).length,
  });
  checks.push({
    name: 'order invoice payment arithmetic',
    failures: orderSnapshots.filter(
      ({ role, payment }) =>
        (role === 'OPEN' || role === 'SALE') &&
        (payment.paid + payment.remaining !== payment.total || payment.paidRaw > payment.total),
    ).length,
  });
  checks.push({
    name: 'provider collection separation',
    failures: orderSnapshots.filter(
      ({ payment }) =>
        payment.route === 'PROVIDER' &&
        (
          !payment.providerPartyId ||
          payment.providerCollected <= 0 ||
          payment.providerRemitted +
            payment.providerFeesOffset +
            payment.providerOutstanding !==
            payment.providerCollected
        ),
    ).length,
  });
  checks.push({
    name: 'active products have valid unique EAN-13 barcodes',
    failures: activeProducts.filter((product, index, rows) =>
      !isValidRetailBarcode(product.retailBarcode) ||
      rows.findIndex((row) => row.retailBarcode === product.retailBarcode) !== index
    ).length,
  });
  const paidTerminalWithoutRefund = orderSnapshots.filter(
    ({ role, order, payment }) => (role === 'CANCELED' || role === 'RETURN') && payment.paidRaw > 0 && order.refundAmount <= 0,
  ).length;
  console.log(`WARN paid canceled/returned orders without recorded refund: ${paidTerminalWithoutRefund}`);

  checks.push({
    name: 'inventory line quantities',
    failures: await count`
      SELECT COUNT(*) AS count FROM (
        SELECT l.id
        FROM "LedgerEntryLine" l
        WHERE l."itemType" = 'INVENTORY'
          AND (
            l."inventoryItemId" IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM "InventoryCostLayer" c
              WHERE c."financeEntryId" = l."financeEntryId"
                AND c."inventoryItemId" = l."inventoryItemId"
                AND c."qtyReceived" = l.quantity
                AND c."unitCost" = l."landedUnitCost"
            )
            OR NOT EXISTS (
              SELECT 1 FROM "StockMovement" m
              WHERE m."financeEntryId" = l."financeEntryId"
                AND m."inventoryItemId" = l."inventoryItemId"
                AND m.quantity = l.quantity
            )
          )
      ) mismatches
    `,
  });

  checks.push({
    name: 'orphan finance-linked inventory records',
    failures: await count`
      SELECT COUNT(*) AS count FROM (
        SELECT c.id
        FROM "InventoryCostLayer" c
        WHERE c."financeEntryId" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "LedgerEntryLine" l
            WHERE l."financeEntryId" = c."financeEntryId"
              AND l."inventoryItemId" = c."inventoryItemId"
              AND l."itemType" = 'INVENTORY'
          )
        UNION ALL
        SELECT m.id
        FROM "StockMovement" m
        WHERE m."financeEntryId" IS NOT NULL AND m.reason = 'PURCHASE'
          AND NOT EXISTS (
            SELECT 1 FROM "LedgerEntryLine" l
            WHERE l."financeEntryId" = m."financeEntryId"
              AND l."inventoryItemId" = m."inventoryItemId"
              AND l."itemType" = 'INVENTORY'
          )
      ) orphans
    `,
  });

  checks.push({
    name: 'asset line allocations',
    failures: await count`
      SELECT COUNT(*) AS count FROM (
        SELECT l."assetKey" AS key
        FROM "LedgerEntryLine" l
        WHERE l."itemType" = 'ASSET' AND l."assetKey" IS NOT NULL
        GROUP BY l."assetKey"
        HAVING SUM(l."lineTotal") <> COALESCE((
          SELECT SUM(a."totalCost") FROM "FixedAsset" a
          WHERE a."importKey" = 'ASSET:HISTORICAL_SPEND:' || l."assetKey"
        ), 0)
        UNION ALL
        SELECT l."financeEntryId" AS key
        FROM "LedgerEntryLine" l
        WHERE l."itemType" = 'ASSET' AND l."assetKey" IS NULL
        GROUP BY l."financeEntryId"
        HAVING SUM(l."lineTotal") <> COALESCE((
          SELECT SUM(a."totalCost") FROM "FixedAsset" a
          WHERE a."financeEntryId" = l."financeEntryId" AND a."importKey" IS NULL
        ), 0)
      ) mismatches
    `,
  });

  checks.push({
    name: 'non-inventory lines without stock links',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "LedgerEntryLine" l
      WHERE l."itemType" <> 'INVENTORY' AND l."inventoryItemId" IS NOT NULL
    `,
  });

  checks.push({
    name: 'fixed asset totals',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "FixedAsset" a
      WHERE ABS((a."unitCost" * a.quantity) - a."totalCost") > 0.001
         OR (a."importKey" IS NULL AND NOT EXISTS (
           SELECT 1 FROM "FinanceEntry" e WHERE e.id = a."financeEntryId"
         ))
    `,
  });

  checks.push({
    name: 'imported fixed asset allocation',
    failures: await count`
      SELECT CASE WHEN
        COALESCE((
          SELECT SUM(a."totalCost")
          FROM "FixedAsset" a
          JOIN "FinanceEntry" e ON e.id = a."financeEntryId"
          WHERE a."importKey" LIKE 'ASSET:HISTORICAL_SPEND:%'
            AND e."importKey" LIKE 'PUR:HISTORICAL_SPEND:%'
        ), 0)
        =
        COALESCE((SELECT SUM(l."lineTotal") FROM "LedgerEntryLine" l JOIN "FinanceEntry" e ON e.id = l."financeEntryId" WHERE l."itemType" = 'ASSET' AND e."importKey" LIKE 'PUR:HISTORICAL_SPEND:%'), 0)
      THEN 0 ELSE 1 END AS count
    `,
  });

  checks.push({
    name: 'over-settled obligations',
    failures: await count`
      SELECT COUNT(*) AS count FROM (
        SELECT obligation.id
        FROM "FinanceEntry" obligation
        JOIN "FinanceEntry" payment ON payment."settlesId" = obligation.id
        WHERE obligation.obligation = true
          AND obligation."archivedAt" IS NULL
          AND obligation."reversedAt" IS NULL
          AND obligation."reversalOfId" IS NULL
          AND payment."archivedAt" IS NULL
          AND payment."reversedAt" IS NULL
          AND payment."reversalOfId" IS NULL
        GROUP BY obligation.id, obligation.amount
        HAVING SUM(payment.amount) > obligation.amount
      ) mismatches
    `,
  });

  checks.push({
    name: 'provider settlement arithmetic',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "ProviderSettlement" s
      WHERE s."grossCleared" <> s."amountReceived" + s."feesOffset"
         OR s."grossCleared" < 0 OR s."amountReceived" < 0 OR s."feesOffset" < 0
    `,
  });

  checks.push({
    name: 'provider cash entry totals',
    failures: await count`
      SELECT COUNT(*) AS count FROM (
        SELECT s.id
        FROM "ProviderSettlement" s
        LEFT JOIN "FinanceEntry" e ON e."providerSettlementId" = s.id
          AND e.type = 'PAYMENT_IN' AND e."accountId" = s."accountId"
          AND e."archivedAt" IS NULL AND e."reversedAt" IS NULL AND e."reversalOfId" IS NULL
        WHERE s."reference" NOT LIKE 'RECON-20260712-HI-FEES'
        GROUP BY s.id, s."amountReceived"
        HAVING COALESCE(SUM(e.amount), 0) <> s."amountReceived"
      ) mismatches
    `,
  });

  checks.push({
    name: 'automatic provider configuration',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "Party" p
      WHERE p."externalKey" IN ('HI_EXPRESS', 'WAYL')
        AND p."isActive" = true
        AND (
          p."collectsOrderPayments" = false
          OR p."automaticOrderSettlement" = false
          OR p."defaultSettlementAccountId" IS NULL
          OR (p."externalKey" = 'HI_EXPRESS' AND p."providerFeeMode" <> 'ORDER_DELIVERY_COST')
          OR (p."externalKey" = 'WAYL' AND (
            p."providerFeeMode" <> 'PERCENT_PLUS_FIXED'
            OR p."feeRateBps" <> 350
            OR p."fixedFee" <> 600
          ))
        )
    `,
  });

  checks.push({
    name: 'automatic order fees are classified and bounded',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "FinanceEntry" fee
      JOIN "Order" o ON o.id = fee."orderId"
      WHERE fee."importKey" LIKE 'ORD:%:PROVIDER:FEE'
        AND fee."archivedAt" IS NULL
        AND fee."reversedAt" IS NULL
        AND fee."reversalOfId" IS NULL
        AND (
          fee.type <> 'EXPENSE'
          OR fee."accountId" IS NULL
          OR fee."costRole" NOT IN ('DIRECT_DELIVERY', 'PAYMENT_PROCESSING')
          OR fee.amount <= 0
          OR fee.amount > GREATEST(
            o."grossAmount" - o."discountAmount" - o."refundAmount"
              + o."deliveryFee" + o."extraCharges",
            0
          )
        )
    `,
  });

  checks.push({
    name: 'branding purchase is a fixed asset',
    failures: await count`
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM "FinanceEntry" WHERE "recordKey" = 'DOC000169'
        ) THEN 0
        WHEN EXISTS (
          SELECT 1
          FROM "FinanceEntry" e
          JOIN "LedgerEntryLine" l ON l."financeEntryId" = e.id
          JOIN "FixedAsset" a ON a."financeEntryId" = e.id
          WHERE e."recordKey" = 'DOC000169'
            AND e.type = 'PURCHASE'
            AND e."recordClass" = 'PURCHASE'
            AND e."categoryType" = 'EQUIPMENT'
            AND l."itemType" = 'ASSET'
            AND l."categoryType" = 'EQUIPMENT'
            AND a.category = 'Brand identity'
            AND a."totalCost" = 1500000
        ) THEN 0
        ELSE 1
      END AS count
    `,
  });

  checks.push({
    name: 'matched Wayl wallet commissions',
    failures: await count`
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM "Setting" WHERE "key" = 'wayl_wallet_unmatched_sales'
        ) THEN 0
        WHEN NOT EXISTS (
          SELECT 1
          FROM "Order"
          WHERE COALESCE(notes, '') ~* '(1A52C792|998C8C52|E3FCD7DA|EB5369GD|I9D0FC09|I56H8BB5|G8G9AHEI)'
        ) THEN 0
        WHEN (
          SELECT COUNT(*) = 7 AND COALESCE(SUM(amount), 0) = 9553
          FROM "FinanceEntry"
          WHERE "importKey" LIKE 'WAYL:COMMISSION:%'
            AND "archivedAt" IS NULL
            AND "reversedAt" IS NULL
            AND "reversalOfId" IS NULL
            AND "costRole" = 'PAYMENT_PROCESSING'
        ) THEN 0
        ELSE 1
      END AS count
    `,
  });

  checks.push({
    name: 'historical orders do not move finished stock',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "Order" o
      JOIN "StockMovement" m ON m."orderId" = o.id AND m.reason = 'SOLD'
      WHERE o."inventorySyncMode" = 'SKIP_HISTORICAL'
    `,
  });

  checks.push({
    name: 'customer cached order statistics',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "Customer" c
      LEFT JOIN (
        SELECT "customerId", COUNT(*)::integer AS order_count,
               MIN("placedAt") AS first_order, MAX("placedAt") AS last_order
        FROM "Order" o
        LEFT JOIN "ListOption" status_role
          ON status_role."listKey" = 'orderStatus' AND status_role.code = o.status
        WHERE COALESCE(status_role."metricRole", CASE WHEN o.status = 'COMPLETED' THEN 'SALE' END) = 'SALE'
          AND "customerId" IS NOT NULL
        GROUP BY "customerId"
      ) actual ON actual."customerId" = c.id
      WHERE c."ordersCount" <> COALESCE(actual.order_count, 0)
         OR c."firstOrderAt" IS DISTINCT FROM actual.first_order
         OR c."lastOrderAt" IS DISTINCT FROM actual.last_order
    `,
  });

  const failed = checks.filter((check) => check.failures > 0);
  for (const check of checks) console.log(`${check.failures === 0 ? 'PASS' : 'FAIL'} ${check.name}: ${check.failures}`);
  if (failed.some((check) => check.name === 'ledger record classifications')) {
    const rows = await prisma.$queryRaw<Array<{
      id: string;
      type: string;
      recordClass: string | null;
      importKey: string | null;
      lineTypes: string[];
    }>>`
      SELECT e.id, e.type::text AS type, e."recordClass"::text AS "recordClass",
             e."importKey" AS "importKey",
             COALESCE(array_agg(l."itemType" ORDER BY l."lineNo") FILTER (WHERE l.id IS NOT NULL), ARRAY[]::text[]) AS "lineTypes"
      FROM "FinanceEntry" e
      LEFT JOIN "LedgerEntryLine" l ON l."financeEntryId" = e.id
      WHERE e.type IN ('EXPENSE', 'PURCHASE')
      GROUP BY e.id
      HAVING e."recordClass" IS DISTINCT FROM CASE
        WHEN e.type = 'EXPENSE' THEN 'EXPENSE'::"LedgerRecordClass"
        WHEN bool_or(l."itemType" IN ('INVENTORY', 'ASSET'))
          AND bool_or(l."itemType" IN ('EXPENSE', 'SERVICE', 'OTHER')) THEN 'MIXED'::"LedgerRecordClass"
        WHEN bool_or(l."itemType" IN ('EXPENSE', 'SERVICE', 'OTHER')) THEN 'EXPENSE'::"LedgerRecordClass"
        ELSE 'PURCHASE'::"LedgerRecordClass"
      END
    `;
    for (const row of rows) console.error(`DETAIL ledger classification: ${JSON.stringify(row)}`);
  }
  if (failed.length) throw new Error(`Reconciliation failed: ${failed.map((check) => check.name).join(', ')}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
