import { PrismaClient } from '@prisma/client';

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
        COALESCE((SELECT SUM(a."totalCost") FROM "FixedAsset" a WHERE a."importKey" LIKE 'ASSET:HISTORICAL_SPEND:%'), 0)
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
  if (failed.length) throw new Error(`Reconciliation failed: ${failed.map((check) => check.name).join(', ')}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
