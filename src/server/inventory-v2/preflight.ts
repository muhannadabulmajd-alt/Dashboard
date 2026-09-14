import { Prisma, type PrismaClient } from '@prisma/client';

type PreflightDb = Pick<PrismaClient, '$queryRaw'>;

export type InventoryPreflightSeverity = 'BLOCKER' | 'WARNING';

export type InventoryPreflightFinding = {
  key: string;
  severity: InventoryPreflightSeverity;
  count: number;
  examples: string[];
  message: string;
};

type FindingRow = {
  count: bigint | number;
  examples: string[] | null;
};

async function finding(
  db: PreflightDb,
  definition: Omit<InventoryPreflightFinding, 'count' | 'examples'>,
  query: Prisma.Sql,
): Promise<InventoryPreflightFinding> {
  const [row] = await db.$queryRaw<FindingRow[]>(query);
  return {
    ...definition,
    count: Number(row?.count ?? 0),
    examples: row?.examples ?? [],
  };
}

async function inventoryV2TablesExist(db: PreflightDb): Promise<boolean> {
  const [row] = await db.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
    SELECT to_regclass('"StockLocation"') IS NOT NULL AS "exists"
  `);
  return row?.exists === true;
}

export async function runInventoryV2Preflight(
  db: PreflightDb,
): Promise<InventoryPreflightFinding[]> {
  const findings = await Promise.all([
    finding(
      db,
      {
        key: 'duplicate_product_inventory_links',
        severity: 'BLOCKER',
        message: 'A tracked SKU must have one company-wide finished-goods definition.',
      },
      Prisma.sql`
        SELECT COUNT(*) AS count,
          COALESCE(array_agg(duplicate.sku ORDER BY duplicate.sku), ARRAY[]::text[]) AS examples
        FROM (
          SELECT p.sku
          FROM "InventoryItem" i
          JOIN "Product" p ON p.id = i."productId"
          WHERE i."isActive" = true
            AND p."isActive" = true
            AND p."trackInventory" = true
          GROUP BY p.id, p.sku
          HAVING COUNT(*) > 1
          LIMIT 25
        ) duplicate
      `,
    ),
    finding(
      db,
      {
        key: 'unassigned_legacy_movements',
        severity: 'BLOCKER',
        message: 'Every legacy movement must resolve from its own branch or its item branch.',
      },
      Prisma.sql`
        SELECT COUNT(*) AS count,
          COALESCE(array_agg(sample.id ORDER BY sample.id), ARRAY[]::text[]) AS examples
        FROM (
          SELECT m.id
          FROM "StockMovement" m
          JOIN "InventoryItem" i ON i.id = m."inventoryItemId"
          WHERE m."branchId" IS NULL AND i."branchId" IS NULL
          LIMIT 25
        ) sample
      `,
    ),
    finding(
      db,
      {
        key: 'negative_legacy_balances',
        severity: 'BLOCKER',
        message: 'Negative stock must be corrected by an approved opening count before activation.',
      },
      Prisma.sql`
        SELECT COUNT(*) AS count,
          COALESCE(array_agg(sample.label ORDER BY sample.label), ARRAY[]::text[]) AS examples
        FROM (
          SELECT i."nameEn" || ' [' || COALESCE(m."branchId", i."branchId", 'unassigned') || ']' AS label
          FROM "StockMovement" m
          JOIN "InventoryItem" i ON i.id = m."inventoryItemId"
          GROUP BY i.id, i."nameEn", COALESCE(m."branchId", i."branchId", 'unassigned')
          HAVING SUM(m.quantity) < 0
          LIMIT 25
        ) sample
      `,
    ),
    finding(
      db,
      {
        key: 'orphan_stock_movements',
        severity: 'BLOCKER',
        message: 'Every stock movement must reference an existing inventory item.',
      },
      Prisma.sql`
        SELECT COUNT(*) AS count,
          COALESCE(array_agg(sample.id ORDER BY sample.id), ARRAY[]::text[]) AS examples
        FROM (
          SELECT m.id
          FROM "StockMovement" m
          LEFT JOIN "InventoryItem" i ON i.id = m."inventoryItemId"
          WHERE i.id IS NULL
          LIMIT 25
        ) sample
      `,
    ),
    finding(
      db,
      {
        key: 'fifo_layer_overdraw',
        severity: 'WARNING',
        message: 'FIFO receipts are lower than post-FIFO outgoing movements; signed opening counts will reset the remaining lots.',
      },
      Prisma.sql`
        SELECT COUNT(*) AS count,
          COALESCE(array_agg(sample.label ORDER BY sample.label), ARRAY[]::text[]) AS examples
        FROM (
          WITH layers AS (
            SELECT "inventoryItemId", MIN("receivedAt") AS first_received,
              SUM("qtyReceived") AS received
            FROM "InventoryCostLayer"
            GROUP BY "inventoryItemId"
          )
          SELECT i."nameEn" AS label
          FROM layers l
          JOIN "InventoryItem" i ON i.id = l."inventoryItemId"
          LEFT JOIN "StockMovement" m
            ON m."inventoryItemId" = l."inventoryItemId"
           AND m."occurredAt" >= l.first_received
           AND m.quantity < 0
          GROUP BY i.id, i."nameEn", l.received
          HAVING -COALESCE(SUM(m.quantity), 0) > l.received
          LIMIT 25
        ) sample
      `,
    ),
    finding(
      db,
      {
        key: 'ambiguous_product_units',
        severity: 'BLOCKER',
        message: 'Inventory definitions linked to one SKU cannot disagree on their base unit.',
      },
      Prisma.sql`
        SELECT COUNT(*) AS count,
          COALESCE(array_agg(sample.sku ORDER BY sample.sku), ARRAY[]::text[]) AS examples
        FROM (
          SELECT p.sku
          FROM "InventoryItem" i
          JOIN "Product" p ON p.id = i."productId"
          GROUP BY p.id, p.sku
          HAVING COUNT(DISTINCT lower(trim(i.unit))) > 1
          LIMIT 25
        ) sample
      `,
    ),
    finding(
      db,
      {
        key: 'duplicate_finance_reversals',
        severity: 'BLOCKER',
        message: 'Each finance entry may have at most one reversal marker before the unique cutover constraint is applied.',
      },
      Prisma.sql`
        SELECT COUNT(*) AS count,
          COALESCE(array_agg(sample."reversalOfId" ORDER BY sample."reversalOfId"), ARRAY[]::text[]) AS examples
        FROM (
          SELECT "reversalOfId"
          FROM "FinanceEntry"
          WHERE "reversalOfId" IS NOT NULL
          GROUP BY "reversalOfId"
          HAVING COUNT(*) > 1
          LIMIT 25
        ) sample
      `,
    ),
  ]);

  if (await inventoryV2TablesExist(db)) {
    findings.push(
      await finding(
        db,
        {
          key: 'unlocated_migrated_movements',
          severity: 'BLOCKER',
          message: 'Every movement must have an explicit physical location before cutover.',
        },
        Prisma.sql`
          SELECT COUNT(*) AS count,
            COALESCE(array_agg(sample.id ORDER BY sample.id), ARRAY[]::text[]) AS examples
          FROM (
            SELECT id FROM "StockMovement" WHERE "locationId" IS NULL LIMIT 25
          ) sample
        `,
      ),
      await finding(
        db,
        {
          key: 'central_fulfillment_location',
          severity: 'BLOCKER',
          message: 'Exactly one active central fulfillment location must be designated.',
        },
        Prisma.sql`
          SELECT CASE WHEN COUNT(*) = 1 THEN 0 ELSE 1 END AS count,
            COALESCE(array_agg(code ORDER BY code), ARRAY[]::text[]) AS examples
          FROM "StockLocation"
          WHERE "isActive" = true AND "isCentralFulfillment" = true
        `,
      ),
      await finding(
        db,
        {
          key: 'opening_counts_missing',
          severity: 'BLOCKER',
          message: 'Every active non-system location needs an approved signed opening count.',
        },
        Prisma.sql`
          SELECT COUNT(*) AS count,
            COALESCE(array_agg(sample.code ORDER BY sample.code), ARRAY[]::text[]) AS examples
          FROM (
            SELECT l.code
            FROM "StockLocation" l
            WHERE l."isActive" = true
              AND l."isSystem" = false
              AND NOT EXISTS (
                SELECT 1 FROM "InventoryCount" c
                WHERE c."locationId" = l.id
                  AND c.kind = 'OPENING'::"InventoryCountKind"
                  AND c.status = 'APPROVED'::"InventoryCountStatus"
                  AND c."openingAttestation" IS NOT NULL
                  AND c."openingAttestedAt" IS NOT NULL
              )
            LIMIT 25
          ) sample
        `,
      ),
      await finding(
        db,
        {
          key: 'opening_counts_incomplete',
          severity: 'BLOCKER',
          message: 'Every approved opening count must explicitly include every active item policy at its location.',
        },
        Prisma.sql`
          SELECT COUNT(*) AS count,
            COALESCE(array_agg(sample.label ORDER BY sample.label), ARRAY[]::text[]) AS examples
          FROM (
            SELECT l.code || ':' || COALESCE(i."externalKey", i."nameEn") AS label
            FROM "InventoryLocationPolicy" p
            JOIN "StockLocation" l ON l.id = p."locationId"
            JOIN "InventoryItem" i ON i.id = p."inventoryItemId"
            WHERE p."isActive" = true
              AND l."isActive" = true
              AND l."isSystem" = false
              AND EXISTS (
                SELECT 1 FROM "InventoryCount" c
                WHERE c."locationId" = l.id
                  AND c.kind = 'OPENING'::"InventoryCountKind"
                  AND c.status = 'APPROVED'::"InventoryCountStatus"
                  AND c."openingAttestation" IS NOT NULL
                  AND c."openingAttestedAt" IS NOT NULL
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "InventoryCount" c
                JOIN "InventoryCountLine" line ON line."inventoryCountId" = c.id
                WHERE c."locationId" = l.id
                  AND c.kind = 'OPENING'::"InventoryCountKind"
                  AND c.status = 'APPROVED'::"InventoryCountStatus"
                  AND c."openingAttestation" IS NOT NULL
                  AND c."openingAttestedAt" IS NOT NULL
                  AND line."inventoryItemId" = p."inventoryItemId"
              )
            LIMIT 25
          ) sample
        `,
      ),
      await finding(
        db,
        {
          key: 'opening_adjustments_without_cost',
          severity: 'BLOCKER',
          message: 'Every positive opening adjustment needs a positive inventory unit cost.',
        },
        Prisma.sql`
          SELECT COUNT(*) AS count,
            COALESCE(array_agg(sample.label ORDER BY sample.label), ARRAY[]::text[]) AS examples
          FROM (
            SELECT c."countNumber" || ':' || COALESCE(i."externalKey", i."nameEn") AS label
            FROM "InventoryCount" c
            JOIN "InventoryCountLine" line ON line."inventoryCountId" = c.id
            JOIN "InventoryItem" i ON i.id = line."inventoryItemId"
            WHERE c.kind = 'OPENING'::"InventoryCountKind"
              AND c.status = 'APPROVED'::"InventoryCountStatus"
              AND line.difference > 0
              AND COALESCE(i."unitCost", 0) <= 0
            LIMIT 25
          ) sample
        `,
      ),
      await finding(
        db,
        {
          key: 'variance_policies_missing',
          severity: 'BLOCKER',
          message: 'Every active operating location needs configured non-cash opening, gain, and loss ledger codes.',
        },
        Prisma.sql`
          SELECT COUNT(*) AS count,
            COALESCE(array_agg(sample.code ORDER BY sample.code), ARRAY[]::text[]) AS examples
          FROM (
            SELECT l.code
            FROM "StockLocation" l
            WHERE l."isActive" = true
              AND l."isSystem" = false
              AND EXISTS (
                SELECT 1 FROM "InventoryLocationPolicy" item_policy
                WHERE item_policy."locationId" = l.id AND item_policy."isActive" = true
              )
              AND NOT EXISTS (
                SELECT 1 FROM "InventoryVariancePolicy" policy
                WHERE policy."locationId" = l.id
                  AND policy."isActive" = true
                  AND NULLIF(trim(policy."openingBalanceAccountCode"), '') IS NOT NULL
                  AND NULLIF(trim(policy."inventoryGainAccountCode"), '') IS NOT NULL
                  AND NULLIF(trim(policy."inventoryLossAccountCode"), '') IS NOT NULL
              )
            LIMIT 25
          ) sample
        `,
      ),
      await finding(
        db,
        {
          key: 'count_variance_postings_missing',
          severity: 'BLOCKER',
          message: 'Every approved count with a difference needs a linked non-cash inventory valuation entry.',
        },
        Prisma.sql`
          SELECT COUNT(*) AS count,
            COALESCE(array_agg(sample."countNumber" ORDER BY sample."countNumber"), ARRAY[]::text[]) AS examples
          FROM (
            SELECT c."countNumber"
            FROM "InventoryCount" c
            WHERE c.status = 'APPROVED'::"InventoryCountStatus"
              AND EXISTS (
                SELECT 1 FROM "InventoryCountLine" line
                WHERE line."inventoryCountId" = c.id AND line.difference <> 0
              )
              AND NOT EXISTS (
                SELECT 1 FROM "FinanceEntry" entry
                WHERE entry."inventoryCountId" = c.id
                  AND entry.type IN (
                    'INVENTORY_GAIN'::"FinanceType",
                    'INVENTORY_LOSS'::"FinanceType"
                  )
              )
            LIMIT 25
          ) sample
        `,
      ),
      await finding(
        db,
        {
          key: 'invalid_count_variance_postings',
          severity: 'BLOCKER',
          message: 'Count valuation entries must reconcile to their lines, remain non-cash, and use the correct opening marker.',
        },
        Prisma.sql`
          SELECT COUNT(*) AS count,
            COALESCE(array_agg(sample.id ORDER BY sample.id), ARRAY[]::text[]) AS examples
          FROM (
            SELECT entry.id
            FROM "FinanceEntry" entry
            JOIN "InventoryCount" c ON c.id = entry."inventoryCountId"
            LEFT JOIN "LedgerEntryLine" line ON line."financeEntryId" = entry.id
            WHERE entry.type IN (
                'INVENTORY_GAIN'::"FinanceType",
                'INVENTORY_LOSS'::"FinanceType"
              )
            GROUP BY entry.id, entry.amount, entry."accountId", entry.obligation,
              entry."accountingCode", entry."isOpeningBalance", c.kind
            HAVING entry."accountId" IS NOT NULL
              OR entry.obligation = true
              OR NULLIF(trim(entry."accountingCode"), '') IS NULL
              OR entry.amount <> COALESCE(SUM(line."lineTotal"), 0)
              OR entry."isOpeningBalance" <> (c.kind = 'OPENING'::"InventoryCountKind")
            LIMIT 25
          ) sample
        `,
      ),
      await finding(
        db,
        {
          key: 'open_stock_discrepancies',
          severity: 'BLOCKER',
          message: 'Every reported transfer or production discrepancy must be centrally reviewed before cutover.',
        },
        Prisma.sql`
          SELECT COUNT(*) AS count,
            COALESCE(array_agg(sample.id ORDER BY sample.id), ARRAY[]::text[]) AS examples
          FROM (
            SELECT discrepancy.id
            FROM "StockDiscrepancy" discrepancy
            WHERE discrepancy.status = 'OPEN'::"StockDiscrepancyStatus"
            LIMIT 25
          ) sample
        `,
      ),
      await finding(
        db,
        {
          key: 'invalid_discrepancy_resolutions',
          severity: 'BLOCKER',
          message: 'Resolved discrepancies need one non-cash valuation entry and every pending stock effect needs matching traceable movements.',
        },
        Prisma.sql`
          SELECT COUNT(*) AS count,
            COALESCE(array_agg(sample.id ORDER BY sample.id), ARRAY[]::text[]) AS examples
          FROM (
            SELECT discrepancy.id
            FROM "StockDiscrepancy" discrepancy
            LEFT JOIN "FinanceEntry" entry ON entry.id = discrepancy."financeEntryId"
            WHERE (
                discrepancy.status = 'RESOLVED'::"StockDiscrepancyStatus"
                AND (
                  discrepancy."resolvedById" IS NULL
                  OR discrepancy."resolvedAt" IS NULL
                  OR discrepancy."reviewIdempotencyKey" IS NULL
                  OR discrepancy."resolutionDocumentId" IS NULL
                  OR discrepancy."financeEntryId" IS NULL
                  OR entry.id IS NULL
                  OR entry.type NOT IN (
                    'INVENTORY_GAIN'::"FinanceType",
                    'INVENTORY_LOSS'::"FinanceType"
                  )
                  OR entry."accountId" IS NOT NULL
                  OR entry.obligation = true
                  OR NULLIF(trim(entry."accountingCode"), '') IS NULL
                  OR entry.amount <= 0
                  OR NOT EXISTS (
                    SELECT 1 FROM "LedgerEntryLine" line
                    WHERE line."financeEntryId" = entry.id
                  )
                  OR (
                    discrepancy."stockEffectPending" = true
                    AND NOT EXISTS (
                      SELECT 1 FROM "StockMovement" movement
                      WHERE movement."stockDocumentId" = discrepancy."resolutionDocumentId"
                        AND movement."financeEntryId" = entry.id
                        AND movement."inventoryItemId" = discrepancy."inventoryItemId"
                    )
                  )
                )
              )
              OR (
                discrepancy.status = 'REJECTED'::"StockDiscrepancyStatus"
                AND (
                  discrepancy."resolvedById" IS NULL
                  OR discrepancy."resolvedAt" IS NULL
                  OR discrepancy."reviewIdempotencyKey" IS NULL
                  OR discrepancy."resolutionDocumentId" IS NOT NULL
                  OR discrepancy."financeEntryId" IS NOT NULL
                )
              )
            LIMIT 25
          ) sample
        `,
      ),
      await finding(
        db,
        {
          key: 'returned_waste_postings_missing',
          severity: 'BLOCKER',
          message: 'Every confirmed returned-goods waste document must post one linked non-cash inventory loss.',
        },
        Prisma.sql`
          SELECT COUNT(*) AS count,
            COALESCE(array_agg(sample."documentNumber" ORDER BY sample."documentNumber"), ARRAY[]::text[]) AS examples
          FROM (
            SELECT document."documentNumber"
            FROM "StockDocument" document
            WHERE document.type = 'WASTE'::"StockDocumentType"
              AND document.status = 'CONFIRMED'::"StockDocumentStatus"
              AND document."returnDisposition" = 'WASTE'::"ReturnDisposition"
              AND NOT EXISTS (
                SELECT 1
                FROM "StockMovement" movement
                JOIN "FinanceEntry" entry ON entry.id = movement."financeEntryId"
                WHERE movement."stockDocumentId" = document.id
                  AND movement.quantity < 0
                  AND entry.type = 'INVENTORY_LOSS'::"FinanceType"
                  AND entry."accountId" IS NULL
                  AND entry.obligation = false
                  AND NULLIF(trim(entry."accountingCode"), '') IS NOT NULL
              )
            LIMIT 25
          ) sample
        `,
      ),
      await finding(
        db,
        {
          key: 'invalid_stock_document_reversals',
          severity: 'BLOCKER',
          message: 'Every reversed stock document needs one confirmed inverse document with balanced lot movements and linked finance reversals.',
        },
        Prisma.sql`
          SELECT COUNT(*) AS count,
            COALESCE(array_agg(sample."documentNumber" ORDER BY sample."documentNumber"), ARRAY[]::text[]) AS examples
          FROM (
            SELECT source."documentNumber"
            FROM "StockDocument" source
            WHERE source.status = 'REVERSED'::"StockDocumentStatus"
              AND source.type IN (
                'PURCHASE_RECEIPT'::"StockDocumentType",
                'ROAST'::"StockDocumentType",
                'PACK'::"StockDocumentType",
                'TRANSFER'::"StockDocumentType",
                'RETURN'::"StockDocumentType",
                'ADJUSTMENT'::"StockDocumentType",
                'WASTE'::"StockDocumentType"
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "StockDocument" reversal
                WHERE reversal."reversalOfId" = source.id
                  AND reversal.type = 'REVERSAL'::"StockDocumentType"
                  AND reversal.status = 'CONFIRMED'::"StockDocumentStatus"
                  AND (
                    SELECT COUNT(*) FROM "StockMovement" movement
                    WHERE movement."stockDocumentId" = source.id
                  ) = (
                    SELECT COUNT(*) FROM "StockMovement" movement
                    WHERE movement."stockDocumentId" = reversal.id
                  )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM (
                      SELECT movement."inventoryItemId", movement."locationId", movement."costLayerId",
                        movement."orderId", movement."orderLineId", movement."roastBatchId",
                        SUM(movement.quantity) AS quantity
                      FROM "StockMovement" movement
                      WHERE movement."stockDocumentId" IN (source.id, reversal.id)
                      GROUP BY movement."inventoryItemId", movement."locationId", movement."costLayerId",
                        movement."orderId", movement."orderLineId", movement."roastBatchId"
                      HAVING ABS(SUM(movement.quantity)) > 0.0005
                    ) imbalance
                  )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM "StockMovement" original_movement
                    JOIN "FinanceEntry" original_entry
                      ON original_entry.id = original_movement."financeEntryId"
                    WHERE original_movement."stockDocumentId" = source.id
                      AND (
                        original_entry."reversedAt" IS NULL
                        OR NOT EXISTS (
                          SELECT 1
                          FROM "FinanceEntry" reversal_entry
                          JOIN "StockMovement" reversal_movement
                            ON reversal_movement."financeEntryId" = reversal_entry.id
                          WHERE reversal_entry."reversalOfId" = original_entry.id
                            AND reversal_movement."stockDocumentId" = reversal.id
                        )
                      )
                  )
              )
            LIMIT 25
          ) sample
        `,
      ),
      await finding(
        db,
        {
          key: 'tracked_products_without_finished_item',
          severity: 'BLOCKER',
          message: 'Every stock-tracked product needs one finished-goods inventory definition.',
        },
        Prisma.sql`
          SELECT COUNT(*) AS count,
            COALESCE(array_agg(sample.sku ORDER BY sample.sku), ARRAY[]::text[]) AS examples
          FROM (
            SELECT p.sku
            FROM "Product" p
            WHERE p."trackInventory" = true
              AND NOT EXISTS (
                SELECT 1 FROM "InventoryItem" i
                WHERE i."productId" = p.id
                  AND i."isActive" = true
                  AND i."branchId" IS NULL
                  AND i.category IN (
                    'FINISHED_GOOD'::"InventoryCategory",
                    'ACCESSORY'::"InventoryCategory"
                  )
              )
            LIMIT 25
          ) sample
        `,
      ),
      await finding(
        db,
        {
          key: 'invalid_finished_item_definitions',
          severity: 'BLOCKER',
          message: 'Tracked product definitions must be company-wide finished goods or accessories.',
        },
        Prisma.sql`
          SELECT COUNT(*) AS count,
            COALESCE(array_agg(sample.sku ORDER BY sample.sku), ARRAY[]::text[]) AS examples
          FROM (
            SELECT DISTINCT p.sku
            FROM "Product" p
            JOIN "InventoryItem" i ON i."productId" = p.id AND i."isActive" = true
            WHERE p."trackInventory" = true
              AND p."isActive" = true
              AND (
                i."branchId" IS NOT NULL
                OR i.category NOT IN (
                  'FINISHED_GOOD'::"InventoryCategory",
                  'ACCESSORY'::"InventoryCategory"
                )
              )
            LIMIT 25
          ) sample
        `,
      ),
      await finding(
        db,
        {
          key: 'central_finished_policy_missing',
          severity: 'BLOCKER',
          message: 'Every tracked product must be sellable through an active policy at the central fulfillment location.',
        },
        Prisma.sql`
          SELECT COUNT(*) AS count,
            COALESCE(array_agg(sample.sku ORDER BY sample.sku), ARRAY[]::text[]) AS examples
          FROM (
            SELECT p.sku
            FROM "Product" p
            WHERE p."trackInventory" = true
              AND p."isActive" = true
              AND NOT EXISTS (
                SELECT 1
                FROM "InventoryItem" i
                JOIN "InventoryLocationPolicy" policy ON policy."inventoryItemId" = i.id
                JOIN "StockLocation" l ON l.id = policy."locationId"
                WHERE i."productId" = p.id
                  AND i."isActive" = true
                  AND i."branchId" IS NULL
                  AND i.category IN (
                    'FINISHED_GOOD'::"InventoryCategory",
                    'ACCESSORY'::"InventoryCategory"
                  )
                  AND policy."isActive" = true
                  AND policy."canSell" = true
                  AND l."isActive" = true
                  AND l."isCentralFulfillment" = true
              )
            LIMIT 25
          ) sample
        `,
      ),
    );
  }

  return findings;
}

export function inventoryPreflightPassed(findings: InventoryPreflightFinding[]): boolean {
  return findings.every((finding) => finding.severity !== 'BLOCKER' || finding.count === 0);
}
