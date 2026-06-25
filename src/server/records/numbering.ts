import 'server-only';
import type { Prisma } from '@prisma/client';
import {
  CUSTOMER_PREFIX,
  ORDER_PREFIX,
  formatCustomerExternalId,
  formatOrderNumber,
  laheebDateKey,
} from '@/lib/numbering';

type Tx = Prisma.TransactionClient;

function nextSequence(values: (string | null)[], pattern: RegExp): number {
  let max = 0;
  for (const value of values) {
    const match = value?.match(pattern);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

export async function generateOrderNumber(tx: Tx, placedAt: Date, channel: string): Promise<string> {
  const dateKey = laheebDateKey(placedAt);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`laheeb-order-${dateKey}`}))`;
  const rows = await tx.order.findMany({
    where: { orderNumber: { startsWith: `${ORDER_PREFIX}-${dateKey}-` } },
    select: { orderNumber: true },
  });
  const sequence = nextSequence(rows.map((row) => row.orderNumber), new RegExp(`^${ORDER_PREFIX}-${dateKey}-[A-Z0-9]+-(\\d{4})$`));
  return formatOrderNumber(placedAt, channel, sequence);
}

export async function generateCustomerExternalId(tx: Tx, createdAt: Date = new Date()): Promise<string> {
  const dateKey = laheebDateKey(createdAt);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`laheeb-customer-${dateKey}`}))`;
  const rows = await tx.customer.findMany({
    where: { externalId: { startsWith: `${CUSTOMER_PREFIX}-${dateKey}-` } },
    select: { externalId: true },
  });
  const sequence = nextSequence(rows.map((row) => row.externalId), new RegExp(`^${CUSTOMER_PREFIX}-${dateKey}-(\\d{4})$`));
  return formatCustomerExternalId(createdAt, sequence);
}
