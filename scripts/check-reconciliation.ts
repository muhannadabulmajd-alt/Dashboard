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
    name: 'fixed asset totals',
    failures: await count`
      SELECT COUNT(*) AS count
      FROM "FixedAsset" a
      JOIN "FinanceEntry" e ON e.id = a."financeEntryId"
      WHERE a."totalCost" <> e.amount
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
