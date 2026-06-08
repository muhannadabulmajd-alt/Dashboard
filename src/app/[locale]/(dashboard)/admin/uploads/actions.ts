'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db/client';
import { requireCap, audit } from '@/server/records/shared';

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
