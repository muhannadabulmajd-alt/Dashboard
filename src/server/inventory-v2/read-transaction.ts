import 'server-only';

import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/client';

export const INVENTORY_READ_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 60_000,
} as const;

export function inventoryReadTransaction<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(callback, INVENTORY_READ_TRANSACTION_OPTIONS);
}
