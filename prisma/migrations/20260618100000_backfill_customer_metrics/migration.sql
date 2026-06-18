-- Rebuild cached customer statistics from the same managed status roles used by reports.
WITH actual AS (
  SELECT
    o."customerId",
    COUNT(*)::integer AS order_count,
    MIN(o."placedAt") AS first_order,
    MAX(o."placedAt") AS last_order
  FROM "Order" o
  LEFT JOIN "ListOption" status_role
    ON status_role."listKey" = 'orderStatus' AND status_role.code = o.status
  WHERE COALESCE(status_role."metricRole", CASE WHEN o.status = 'COMPLETED' THEN 'SALE' END) = 'SALE'
    AND o."customerId" IS NOT NULL
  GROUP BY o."customerId"
)
UPDATE "Customer" c
SET
  "ordersCount" = COALESCE(actual.order_count, 0),
  "firstOrderAt" = actual.first_order,
  "lastOrderAt" = actual.last_order
FROM (SELECT c2.id, a.order_count, a.first_order, a.last_order
      FROM "Customer" c2 LEFT JOIN actual a ON a."customerId" = c2.id) actual
WHERE actual.id = c.id;
