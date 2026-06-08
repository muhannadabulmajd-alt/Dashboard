'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db/client';
import { getCurrentUser } from '@/server/auth/session';
import { requireCap, audit, reqField, type ActionState } from '@/server/records/shared';

// All business/operational tables wiped by a full data reset. KEEP: User,
// Branch, ExpenseCategory, AuditLog, Connector, Setting. No kept table has a
// foreign key into these, so TRUNCATE ... CASCADE can't touch the kept ones.
const RESET_TABLES = [
  'Order',
  'OrderLine',
  'StockMovement',
  'InventoryItem',
  'Product',
  'ProductComponent',
  'ProductGroup',
  'Customer',
  'RoastBatch',
  'BatchSkuLink',
  'Expense',
  'Offer',
  'Shipment',
  'UploadBatch',
  'SyncRun',
  'FinanceAccount',
  'Party',
  'FinanceEntry',
] as const;

/**
 * Owner-only, typed-confirm full reset of business data (re-import from scratch).
 * Irreversible. Keeps users, branches, settings, connectors, expense categories.
 */
export async function resetBusinessData(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== 'OWNER') return { error: 'forbidden' };
  if (reqField(fd, 'confirm') !== 'RESET') return { error: 'confirm' };
  const list = RESET_TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  await audit(user.id, 'RESET_DATA', 'System', { tables: RESET_TABLES.length });
  revalidatePath('/[locale]/(dashboard)/admin/uploads');
  return { ok: true };
}

/**
 * Remove exact-duplicate imported finance rows, keeping the earliest of each
 * identical set. "Identical" = same type/date/amount/party/reference/description/
 * category among imported (importKey-bearing) PURCHASE/CAPITAL_IN entries. The
 * current importer is idempotent, so this only ever catches rows created by
 * mixing manual entry with imports (or legacy anomalies); it is a safe no-op
 * otherwise.
 */
export async function cleanupDuplicateFinanceImports(): Promise<void> {
  const user = await requireCap('upload:data');
  if (!user) return;
  const removed = await prisma.$executeRawUnsafe(`
    DELETE FROM "FinanceEntry" a
    USING (
      SELECT id, row_number() OVER (
        PARTITION BY type, date, amount, "partyId", reference, description, "categoryType"
        ORDER BY "createdAt" ASC, id ASC
      ) AS rn
      FROM "FinanceEntry"
      WHERE type IN ('PURCHASE', 'CAPITAL_IN') AND "importKey" IS NOT NULL
    ) b
    WHERE a.id = b.id AND b.rn > 1
  `);
  if (removed > 0) await audit(user.id, 'cleanup_duplicate_imports', 'FinanceEntry', { removed });
  revalidatePath('/[locale]/(dashboard)/admin/uploads');
  revalidatePath('/[locale]/(dashboard)/finance');
}
