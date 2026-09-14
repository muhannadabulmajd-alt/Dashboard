import 'server-only';
import type { Prisma, StockDocumentType } from '@prisma/client';
import { laheebDateKey } from '@/lib/numbering';

type Tx = Prisma.TransactionClient;

const TYPE_CODES: Record<StockDocumentType, string> = {
  OPENING: 'OPN',
  PURCHASE_RECEIPT: 'RCV',
  ROAST: 'RST',
  PACK: 'PCK',
  TRANSFER: 'TRF',
  SALE: 'SAL',
  RETURN: 'RTN',
  COUNT: 'CNT',
  ADJUSTMENT: 'ADJ',
  WASTE: 'WST',
  REVERSAL: 'REV',
};

export async function generateStockDocumentNumber(
  tx: Tx,
  type: StockDocumentType,
  occurredAt: Date,
): Promise<string> {
  const dateKey = laheebDateKey(occurredAt);
  const prefix = `LHB-STK-${dateKey}-${TYPE_CODES[type]}`;
  await tx.$queryRaw<{ locked: number }[]>`
    SELECT 1 AS locked
    WHERE pg_advisory_xact_lock(hashtext(${`laheeb-stock-${type}-${dateKey}`})) IS NULL
  `;
  const rows = await tx.stockDocument.findMany({
    where: { documentNumber: { startsWith: `${prefix}-` } },
    select: { documentNumber: true },
  });
  const max = rows.reduce((value, row) => {
    const sequence = Number(row.documentNumber.slice(prefix.length + 1));
    return Number.isInteger(sequence) ? Math.max(value, sequence) : value;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

export function stockLotNumber(documentNumber: string, line = 1): string {
  return `${documentNumber}-LOT-${String(line).padStart(3, '0')}`;
}

export async function generateLocalExpenseRequestNumber(
  tx: Tx,
  occurredAt: Date,
): Promise<string> {
  const dateKey = laheebDateKey(occurredAt);
  const prefix = `LHB-EXP-${dateKey}`;
  await tx.$queryRaw<{ locked: number }[]>`
    SELECT 1 AS locked
    WHERE pg_advisory_xact_lock(hashtext(${`laheeb-local-expense-${dateKey}`})) IS NULL
  `;
  const rows = await tx.localExpenseRequest.findMany({
    where: { requestNumber: { startsWith: `${prefix}-` } },
    select: { requestNumber: true },
  });
  const max = rows.reduce((value, row) => {
    const sequence = Number(row.requestNumber.slice(prefix.length + 1));
    return Number.isInteger(sequence) ? Math.max(value, sequence) : value;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}
