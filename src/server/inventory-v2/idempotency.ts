import 'server-only';

import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (value instanceof Uint8Array) {
    return {
      $bytesSha256: createHash('sha256').update(value).digest('hex'),
      $byteLength: value.byteLength,
    };
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  return value;
}

export function inventoryCommandInputHash(
  action: string,
  actorId: string,
  command: unknown,
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize({ action, actorId, command })))
    .digest('hex');
}

export function assertInventoryCommandReplay(
  storedInputHash: string | null | undefined,
  expectedInputHash: string,
): void {
  if (!storedInputHash || storedInputHash !== expectedInputHash) {
    throw new Error('idempotency_conflict');
  }
}

export async function lockInventoryCommandKey(tx: Tx, key: string): Promise<void> {
  await tx.$queryRaw<Array<{ locked: number }>>`
    SELECT 1 AS locked
    WHERE pg_advisory_xact_lock(hashtext(${`inventory-v2-command:${key}`})) IS NULL
  `;
}
