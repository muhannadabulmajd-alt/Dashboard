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
            WHERE l."financeEntryId" = e.id AND l."spendTreatment" IN ('INVENTORY', 'CAPEX')
          ) AND EXISTS (
            SELECT 1 FROM "LedgerEntryLine" l
            WHERE l."financeEntryId" = e.id AND l."spendTreatment" IN ('OPEX', 'REVIEW')
          ) THEN 'MIXED'::"LedgerRecordClass"
          WHEN EXISTS (
            SELECT 1 FROM "LedgerEntryLine" l
            WHERE l."financeEntryId" = e.id AND l."spendTreatment" IN ('OPEX', 'REVIEW')
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
    name: 'canonical spending line treatments',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "FinanceEntry" e
      WHERE e.type IN ('EXPENSE', 'PURCHASE')
        AND e."archivedAt" IS NULL
        AND e."reversedAt" IS NULL
        AND e."reversalOfId" IS NULL
        AND (
          NOT EXISTS (
            SELECT 1 FROM "LedgerEntryLine" l WHERE l."financeEntryId" = e.id
          )
          OR EXISTS (
            SELECT 1
            FROM "LedgerEntryLine" l
            WHERE l."financeEntryId" = e.id
              AND (
                l."spendTreatment" IS NULL
                OR (l."spendTreatment" = 'REVIEW' AND l."classificationStatus" <> 'NEEDS_REVIEW')
              )
          )
        )
    `,
  });

  checks.push({
    name: 'recorded spending equation',
    failures: await count`
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM "Setting" WHERE "key" = 'finance_integrity_expected_total_spending'
        ) THEN 0
        WHEN (
          SELECT COALESCE(SUM(l."lineTotal"), 0)
          FROM "LedgerEntryLine" l
          JOIN "FinanceEntry" e ON e.id = l."financeEntryId"
          WHERE e.type IN ('EXPENSE', 'PURCHASE')
            AND e."archivedAt" IS NULL
            AND e."reversedAt" IS NULL
            AND e."reversalOfId" IS NULL
            AND e."createdAt" <= (
              SELECT value::timestamp(3)
              FROM "Setting"
              WHERE "key" = 'finance_integrity_expected_cutoff'
            )
        ) = (
          SELECT value::bigint
          FROM "Setting"
          WHERE "key" = 'finance_integrity_expected_total_spending'
        ) THEN 0
        ELSE 1
      END AS count
    `,
  });

  checks.push({
    name: 'recorded spending bucket targets',
    failures: await count`
      WITH baseline AS (
        SELECT
          MAX(value::bigint) FILTER (WHERE "key" = 'finance_integrity_expected_capex') AS capex,
          MAX(value::bigint) FILTER (WHERE "key" = 'finance_integrity_expected_inventory') AS inventory,
          MAX(value::bigint) FILTER (WHERE "key" = 'finance_integrity_expected_operating') AS operating,
          MAX(value::timestamp(3)) FILTER (WHERE "key" = 'finance_integrity_expected_cutoff') AS cutoff
        FROM "Setting"
      ), current_buckets AS (
        SELECT
          COALESCE(SUM(l."lineTotal") FILTER (WHERE l."spendTreatment" = 'CAPEX'), 0)::bigint AS capex,
          COALESCE(SUM(l."lineTotal") FILTER (WHERE l."spendTreatment" = 'INVENTORY'), 0)::bigint AS inventory,
          COALESCE(SUM(l."lineTotal") FILTER (WHERE l."spendTreatment" IN ('OPEX', 'REVIEW')), 0)::bigint AS operating
        FROM "LedgerEntryLine" l
        JOIN "FinanceEntry" e ON e.id = l."financeEntryId"
        CROSS JOIN baseline b
        WHERE e.type IN ('EXPENSE', 'PURCHASE')
          AND e."archivedAt" IS NULL
          AND e."reversedAt" IS NULL
          AND e."reversalOfId" IS NULL
          AND e."createdAt" <= b.cutoff
      ), audited_reclassifications AS (
        SELECT
          COALESCE(SUM(
            CASE WHEN a.metadata->'after'->>'spendTreatment' = 'CAPEX' THEN (a.metadata->>'amount')::bigint ELSE 0 END
            - CASE WHEN a.metadata->'before'->>'spendTreatment' = 'CAPEX' THEN (a.metadata->>'amount')::bigint ELSE 0 END
          ), 0)::bigint AS capex,
          COALESCE(SUM(
            CASE WHEN a.metadata->'after'->>'spendTreatment' = 'INVENTORY' THEN (a.metadata->>'amount')::bigint ELSE 0 END
            - CASE WHEN a.metadata->'before'->>'spendTreatment' = 'INVENTORY' THEN (a.metadata->>'amount')::bigint ELSE 0 END
          ), 0)::bigint AS inventory,
          COALESCE(SUM(
            CASE WHEN a.metadata->'after'->>'spendTreatment' IN ('OPEX', 'REVIEW') THEN (a.metadata->>'amount')::bigint ELSE 0 END
            - CASE WHEN a.metadata->'before'->>'spendTreatment' IN ('OPEX', 'REVIEW') THEN (a.metadata->>'amount')::bigint ELSE 0 END
          ), 0)::bigint AS operating
        FROM "AuditLog" a
        JOIN "LedgerEntryLine" l ON l.id = a."entityId"
        JOIN "FinanceEntry" e ON e.id = l."financeEntryId"
        CROSS JOIN baseline b
        WHERE a.action = 'RECLASSIFY_LEDGER_LINE'
          AND a.entity = 'LedgerEntryLine'
          AND a."userId" IS NOT NULL
          AND a."createdAt" > b.cutoff
          AND e."createdAt" <= b.cutoff
          AND a.metadata->>'amount' ~ '^[0-9]+$'
      ), audited_splits AS (
        SELECT
          COALESCE(SUM(
            CASE WHEN a.metadata->>'splitTreatment' = 'CAPEX' THEN (a.metadata->>'splitAmount')::bigint ELSE 0 END
            - CASE WHEN a.metadata->>'originalTreatment' = 'CAPEX' THEN (a.metadata->>'splitAmount')::bigint ELSE 0 END
          ), 0)::bigint AS capex,
          COALESCE(SUM(
            CASE WHEN a.metadata->>'splitTreatment' = 'INVENTORY' THEN (a.metadata->>'splitAmount')::bigint ELSE 0 END
            - CASE WHEN a.metadata->>'originalTreatment' = 'INVENTORY' THEN (a.metadata->>'splitAmount')::bigint ELSE 0 END
          ), 0)::bigint AS inventory,
          COALESCE(SUM(
            CASE WHEN a.metadata->>'splitTreatment' IN ('OPEX', 'REVIEW') THEN (a.metadata->>'splitAmount')::bigint ELSE 0 END
            - CASE WHEN a.metadata->>'originalTreatment' IN ('OPEX', 'REVIEW') THEN (a.metadata->>'splitAmount')::bigint ELSE 0 END
          ), 0)::bigint AS operating
        FROM "AuditLog" a
        JOIN "LedgerEntryLine" l ON l.id = a."entityId"
        JOIN "FinanceEntry" e ON e.id = l."financeEntryId"
        CROSS JOIN baseline b
        WHERE a.action = 'SPLIT_LEDGER_LINE'
          AND a.entity = 'LedgerEntryLine'
          AND a."userId" IS NOT NULL
          AND a."createdAt" > b.cutoff
          AND e."createdAt" <= b.cutoff
          AND a.metadata->>'splitAmount' ~ '^[0-9]+$'
          AND a.metadata ? 'originalTreatment'
      )
      SELECT CASE
        WHEN b.capex IS NULL OR b.inventory IS NULL OR b.operating IS NULL OR b.cutoff IS NULL THEN 0
        WHEN c.capex = b.capex + r.capex + s.capex
          AND c.inventory = b.inventory + r.inventory + s.inventory
          AND c.operating = b.operating + r.operating + s.operating THEN 0
        ELSE 1
      END AS count
      FROM baseline b
      CROSS JOIN current_buckets c
      CROSS JOIN audited_reclassifications r
      CROSS JOIN audited_splits s
    `,
  });

  checks.push({
    name: 'corrected sales and promotion targets',
    failures: await count`
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM "Setting" WHERE "key" = 'finance_integrity_expected_sales'
        ) THEN 0
        WHEN (
          SELECT COALESCE(SUM(GREATEST(
            "grossAmount" - "discountAmount" - "refundAmount"
              + "deliveryFee" + "extraCharges",
            0
          )), 0)
          FROM "Order"
          WHERE status = 'COMPLETED'
            AND purpose = 'SALE'
            AND "createdAt" <= (
              SELECT value::timestamp(3)
              FROM "Setting"
              WHERE "key" = 'finance_integrity_expected_cutoff'
            )
        ) = (
          SELECT value::bigint FROM "Setting"
          WHERE "key" = 'finance_integrity_expected_sales'
        ) AND (
          SELECT COUNT(*)
          FROM "Order"
          WHERE status = 'COMPLETED'
            AND purpose = 'SALE'
            AND "createdAt" <= (
              SELECT value::timestamp(3)
              FROM "Setting"
              WHERE "key" = 'finance_integrity_expected_cutoff'
            )
        ) = (
          SELECT value::bigint FROM "Setting"
          WHERE "key" = 'finance_integrity_expected_sale_orders'
        ) AND (
          SELECT COUNT(*)
          FROM "Order"
          WHERE status = 'COMPLETED'
            AND purpose = 'PROMOTION'
            AND "createdAt" <= (
              SELECT value::timestamp(3)
              FROM "Setting"
              WHERE "key" = 'finance_integrity_expected_cutoff'
            )
        ) = (
          SELECT value::bigint FROM "Setting"
          WHERE "key" = 'finance_integrity_expected_promotion_orders'
        ) THEN 0
        ELSE 1
      END AS count
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
          AND NOT EXISTS (
            SELECT 1
            FROM "InventoryLandedCostAllocation" allocation
            WHERE allocation."ledgerLineId" = l.id
          )
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
    name: 'landed cost allocations',
    failures: await count`
      SELECT COUNT(*) AS count FROM (
        SELECT allocation.id AS key
        FROM "InventoryLandedCostAllocation" allocation
        LEFT JOIN "LedgerEntryLine" line ON line.id = allocation."ledgerLineId"
        LEFT JOIN "InventoryCostLayer" layer ON layer.id = allocation."costLayerId"
        WHERE allocation.amount <= 0
          OR line.id IS NULL
          OR line."financeEntryId" <> allocation."financeEntryId"
          OR (
            (allocation."inventoryItemId" IS NULL)
              <> (allocation."costLayerId" IS NULL)
          )
          OR (
            allocation."inventoryItemId" IS NOT NULL
            AND (
              layer.id IS NULL
              OR layer."inventoryItemId" <> allocation."inventoryItemId"
            )
          )
        UNION ALL
        SELECT line.id AS key
        FROM "LedgerEntryLine" line
        JOIN "InventoryLandedCostAllocation" allocation
          ON allocation."ledgerLineId" = line.id
        GROUP BY line.id, line."lineTotal"
        HAVING SUM(allocation.amount) <> line."lineTotal"
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
    name: 'active FIFO cost cache',
    failures: await count`
      WITH active_layers AS (
        SELECT
          layer.id,
          layer."inventoryItemId",
          layer."unitCost",
          layer."receivedAt",
          SUM(layer."qtyReceived") OVER (
            PARTITION BY layer."inventoryItemId"
            ORDER BY layer."receivedAt", layer.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS cumulative_received,
          MIN(layer."receivedAt") OVER (
            PARTITION BY layer."inventoryItemId"
          ) AS first_received
        FROM "InventoryCostLayer" layer
        LEFT JOIN "FinanceEntry" source ON source.id = layer."financeEntryId"
        WHERE layer."financeEntryId" IS NULL
          OR (
            source."archivedAt" IS NULL
            AND source."reversedAt" IS NULL
            AND source."reversalOfId" IS NULL
          )
      ),
      consumed AS (
        SELECT
          layer."inventoryItemId",
          COALESCE(-SUM(movement.quantity) FILTER (
            WHERE movement.quantity < 0
              AND movement."occurredAt" >= layer.first_received
              AND (
                movement."financeEntryId" IS NULL
                OR (
                  movement_source."archivedAt" IS NULL
                  AND movement_source."reversedAt" IS NULL
                  AND movement_source."reversalOfId" IS NULL
                )
              )
          ), 0) AS quantity_consumed
        FROM (
          SELECT "inventoryItemId", MIN(first_received) AS first_received
          FROM active_layers
          GROUP BY "inventoryItemId"
        ) layer
        LEFT JOIN "StockMovement" movement
          ON movement."inventoryItemId" = layer."inventoryItemId"
        LEFT JOIN "FinanceEntry" movement_source
          ON movement_source.id = movement."financeEntryId"
        GROUP BY layer."inventoryItemId"
      ),
      active_cost AS (
        SELECT DISTINCT ON (layer."inventoryItemId")
          layer."inventoryItemId",
          layer."unitCost"
        FROM active_layers layer
        JOIN consumed
          ON consumed."inventoryItemId" = layer."inventoryItemId"
        WHERE layer.cumulative_received > consumed.quantity_consumed
        ORDER BY layer."inventoryItemId", layer."receivedAt", layer.id
      )
      SELECT COUNT(*) AS count
      FROM active_cost
      JOIN "InventoryItem" item ON item.id = active_cost."inventoryItemId"
      WHERE item."unitCost" IS NULL
        OR ABS(item."unitCost" - active_cost."unitCost") > 0.001
    `,
  });

  checks.push({
    name: 'product component cost cache',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "Product" product
      JOIN (
        SELECT component."productId",
               ROUND(SUM(component.quantity * component."unitCost"))::integer AS expected
        FROM "ProductComponent" component
        GROUP BY component."productId"
      ) cost ON cost."productId" = product.id
      WHERE product."cogsPerUnit" <> cost.expected
    `,
  });

  checks.push({
    name: 'asset line allocations',
    failures: await count`
      SELECT COUNT(*) AS count FROM (
        SELECT l.id AS key
        FROM "LedgerEntryLine" l
        JOIN "FinanceEntry" e ON e.id = l."financeEntryId"
        WHERE l."spendTreatment" = 'CAPEX'
          AND e."archivedAt" IS NULL
          AND e."reversedAt" IS NULL
          AND e."reversalOfId" IS NULL
          AND COALESCE((
            SELECT SUM(allocation.amount)
            FROM "FixedAssetCostAllocation" allocation
            WHERE allocation."ledgerLineId" = l.id
          ), 0) <> l."lineTotal"
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
    name: 'fixed asset allocation totals',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "FixedAsset" asset
      WHERE asset."isActive" = true
        AND asset."archivedAt" IS NULL
        AND COALESCE((
          SELECT SUM(allocation.amount)
          FROM "FixedAssetCostAllocation" allocation
          JOIN "FinanceEntry" source ON source.id = allocation."financeEntryId"
          WHERE allocation."fixedAssetId" = asset.id
            AND source."archivedAt" IS NULL
            AND source."reversedAt" IS NULL
            AND source."reversalOfId" IS NULL
        ), 0) <> asset."totalCost"
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
    name: 'provider clearing configuration',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "Party" p
      WHERE p."externalKey" IN ('HI_EXPRESS', 'WAYL', 'STORIX')
        AND p."isActive" = true
        AND (
          p."collectsOrderPayments" = false
          OR p."automaticOrderSettlement" = true
          OR p."defaultSettlementAccountId" IS NULL
          OR (p."externalKey" IN ('HI_EXPRESS', 'STORIX') AND p."providerFeeMode" <> 'ORDER_DELIVERY_COST')
          OR (p."externalKey" = 'WAYL' AND (
            p."providerFeeMode" <> 'PERCENT_PLUS_FIXED'
            OR p."feeRateBps" <> 350
            OR p."fixedFee" <> 600
          ))
        )
    `,
  });

  checks.push({
    name: 'provider order fees are classified and bounded',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "FinanceEntry" fee
      JOIN "Order" o ON o.id = fee."orderId"
      WHERE (
          fee."importKey" LIKE 'ORD:%:PROVIDER:FEE'
          OR fee."importKey" LIKE 'SHIP:%:COST'
        )
        AND fee."archivedAt" IS NULL
        AND fee."reversedAt" IS NULL
        AND fee."reversalOfId" IS NULL
        AND (
          fee.type <> 'EXPENSE'
          OR NOT (
            (
              fee.obligation = true
              AND fee."obligationKind" = 'PAYABLE'
              AND fee."accountId" IS NULL
            )
            OR (
              fee.obligation = false
              AND fee."obligationKind" IS NULL
              AND fee."accountId" IS NOT NULL
            )
          )
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
    name: 'orders have at most one active direct delivery cost',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM (
        SELECT fee."orderId"
        FROM "FinanceEntry" fee
        WHERE fee."orderId" IS NOT NULL
          AND fee."costRole" = 'DIRECT_DELIVERY'
          AND fee."archivedAt" IS NULL
          AND fee."reversedAt" IS NULL
          AND fee."reversalOfId" IS NULL
        GROUP BY fee."orderId"
        HAVING COUNT(*) > 1
      ) duplicates
    `,
  });

  checks.push({
    name: 'branding payments consolidate to one fixed asset',
    failures: await count`
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM "FinanceEntry" WHERE "recordKey" = 'DOC000144'
        ) THEN 0
        WHEN (
          SELECT COUNT(*) = 1 AND SUM("totalCost") = 6000000
          FROM "FixedAsset"
          WHERE "importKey" = 'ASSET:BRAND_IDENTITY:LAHEEB' AND "isActive" = true
        ) AND (
          SELECT COUNT(*) = 3 AND SUM(amount) = 6000000
          FROM "FixedAssetCostAllocation"
          WHERE "importKey" LIKE 'ASSET:BRAND_IDENTITY:LAHEEB:DOC%'
        ) THEN 0
        ELSE 1
      END AS count
    `,
  });

  checks.push({
    name: 'Wayl statement and clearing wallet',
    failures: await count`
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1
          FROM "PaymentReconciliationItem" item
          JOIN "Party" provider ON provider.id = item."providerPartyId"
          WHERE provider."externalKey" = 'WAYL'
        ) AND NOT EXISTS (
          SELECT 1
          FROM "Setting"
          WHERE "key" = 'external_reports_reconciliation_version'
            AND value = '2026-08-12-v1'
        ) THEN 0
        WHEN (
          SELECT COUNT(*) = 17
            AND COALESCE(SUM(item."grossAmount"), 0) = 402000
            AND COALESCE(SUM(item."feeAmount"), 0) = 24266
            AND COUNT(*) FILTER (WHERE item.status = 'NEEDS_ORDER') = 0
          FROM "PaymentReconciliationItem" item
          JOIN "Party" provider ON provider.id = item."providerPartyId"
          WHERE provider."externalKey" = 'WAYL'
        ) AND (
          SELECT COALESCE(SUM(CASE
            WHEN e."accountId" = account.id THEN
              CASE
                WHEN e.type IN ('INCOME', 'PAYMENT_IN', 'CAPITAL_IN') THEN e.amount
                WHEN e.type IN ('EXPENSE', 'PURCHASE', 'PAYMENT_OUT', 'DRAWING', 'TRANSFER') THEN -e.amount
                ELSE 0
              END
            WHEN e."toAccountId" = account.id AND e.type = 'TRANSFER' THEN e.amount
            ELSE 0
          END), 0) + account."openingBalance"
          FROM "FinanceAccount" account
          LEFT JOIN "FinanceEntry" e
            ON (e."accountId" = account.id OR e."toAccountId" = account.id)
            AND e.obligation = false
            AND e."archivedAt" IS NULL
            AND e."reversedAt" IS NULL
            AND e."reversalOfId" IS NULL
          WHERE account."externalKey" = 'WAYL_WALLET'
          GROUP BY account.id
        ) = 14840 AND (
          SELECT COUNT(*) = 17 AND COALESCE(SUM(amount), 0) = 24266
          FROM "FinanceEntry"
          WHERE "importKey" LIKE 'WAYL:STATEMENT:%:FEE'
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
    name: 'external report order snapshot',
    failures: await count`
      WITH reconciliation AS (
        SELECT 1
        FROM "Setting"
        WHERE "key" = 'external_reports_reconciliation_version'
          AND value = '2026-08-12-v1'
      ), external_orders AS (
        SELECT orders.id, orders.status
        FROM "Order" orders
        WHERE orders.id LIKE 'ext-order-%'
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM reconciliation) THEN 0
        WHEN (SELECT COUNT(*) FROM external_orders) = 26
          AND (SELECT COUNT(*) FROM external_orders WHERE status = 'COMPLETED') = 20
          AND (SELECT COUNT(*) FROM external_orders WHERE status = 'PENDING') = 6
        THEN 0
        ELSE 1
      END AS count
    `,
  });

  checks.push({
    name: 'pending external orders have no finance or sold stock',
    failures: await count`
      WITH reconciliation AS (
        SELECT 1
        FROM "Setting"
        WHERE "key" = 'external_reports_reconciliation_version'
          AND value = '2026-08-12-v1'
      ), pending_orders AS (
        SELECT orders.id
        FROM "Order" orders
        WHERE orders.id LIKE 'ext-order-%' AND orders.status = 'PENDING'
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM reconciliation) THEN 0
        ELSE (
          SELECT COUNT(*)
          FROM pending_orders
          WHERE EXISTS (
            SELECT 1 FROM "FinanceEntry" entry WHERE entry."orderId" = pending_orders.id
          ) OR EXISTS (
            SELECT 1
            FROM "StockMovement" movement
            WHERE movement."orderId" = pending_orders.id AND movement.reason = 'SOLD'
          )
        )
      END AS count
    `,
  });

  checks.push({
    name: 'Storix completed invoices and outstanding balance',
    failures: await count`
      WITH reconciliation AS (
        SELECT 1
        FROM "Setting"
        WHERE "key" = 'external_reports_reconciliation_version'
          AND value = '2026-08-12-v1'
      ), active_finance AS (
        SELECT *
        FROM "FinanceEntry"
        WHERE "archivedAt" IS NULL AND "reversedAt" IS NULL AND "reversalOfId" IS NULL
      ), storix_receivables AS (
        SELECT
          receivable.id,
          receivable."orderId",
          orders.status,
          receivable.amount - COALESCE(SUM(settlement.amount), 0)::integer AS outstanding
        FROM active_finance receivable
        JOIN "Party" storix
          ON storix.id = receivable."partyId" AND storix."externalKey" = 'STORIX'
        JOIN "Order" orders ON orders.id = receivable."orderId"
        LEFT JOIN active_finance settlement ON settlement."settlesId" = receivable.id
        WHERE receivable.obligation = true
          AND receivable."obligationKind" = 'RECEIVABLE'
        GROUP BY receivable.id, receivable."orderId", orders.status, receivable.amount
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM reconciliation) THEN 0
        WHEN (SELECT COUNT(*) FROM storix_receivables) = 5
          AND (SELECT COUNT(DISTINCT "orderId") FROM storix_receivables) = 5
          AND NOT EXISTS (SELECT 1 FROM storix_receivables WHERE status <> 'COMPLETED')
          AND (SELECT COALESCE(SUM(outstanding), 0) FROM storix_receivables) = 70500
        THEN 0
        ELSE 1
      END AS count
    `,
  });

  checks.push({
    name: 'external reconciliation Wayl payouts',
    failures: await count`
      WITH reconciliation AS (
        SELECT 1
        FROM "Setting"
        WHERE "key" = 'external_reports_reconciliation_version'
          AND value = '2026-08-12-v1'
      ), payouts AS (
        SELECT payout.*
        FROM "FinanceEntry" payout
        WHERE payout."importKey" LIKE 'WAYL:PAYOUT:%'
          AND payout."archivedAt" IS NULL
          AND payout."reversedAt" IS NULL
          AND payout."reversalOfId" IS NULL
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM reconciliation) THEN 0
        WHEN (SELECT COALESCE(SUM(amount), 0) FROM payouts) = 362894
          AND NOT EXISTS (
            SELECT 1
            FROM payouts payout
            LEFT JOIN "FinanceAccount" source ON source.id = payout."accountId"
            LEFT JOIN "FinanceAccount" destination ON destination.id = payout."toAccountId"
            WHERE payout.type <> 'TRANSFER'
              OR payout.amount <= 0
              OR payout.currency <> 'IQD'
              OR payout.obligation = true
              OR source."externalKey" IS DISTINCT FROM 'WAYL_WALLET'
              OR destination."externalKey" IS DISTINCT FROM 'FIB'
          )
        THEN 0
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
          AND o.purpose = 'SALE'
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
          WHEN bool_or(l."spendTreatment" IN ('INVENTORY', 'CAPEX'))
            AND bool_or(l."spendTreatment" IN ('OPEX', 'REVIEW')) THEN 'MIXED'::"LedgerRecordClass"
          WHEN bool_or(l."spendTreatment" IN ('OPEX', 'REVIEW')) THEN 'EXPENSE'::"LedgerRecordClass"
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
