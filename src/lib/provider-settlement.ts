export type ProviderOpenOrder = {
  orderId: string;
  receivableId: string;
  receivableOutstanding: number;
  feePayableId?: string | null;
  feeOutstanding?: number;
};

export type ProviderAllocation = ProviderOpenOrder & {
  cashApplied: number;
  feeOffset: number;
  grossCleared: number;
  fullySettled: boolean;
};

/** Allocate one net provider deposit oldest-first without inventing cash. */
export function allocateProviderDeposit(
  rows: ProviderOpenOrder[],
  amountReceived: number,
  netFees: boolean,
): ProviderAllocation[] {
  if (!Number.isInteger(amountReceived) || amountReceived < 0) throw new Error('invalid_amount');
  let cashRemaining = amountReceived;
  const allocations: ProviderAllocation[] = [];

  for (const row of rows) {
    if (row.receivableOutstanding <= 0) continue;
    const availableFee = netFees
      ? Math.min(row.receivableOutstanding, Math.max(0, row.feeOutstanding ?? 0))
      : 0;
    const netNeeded = Math.max(0, row.receivableOutstanding - availableFee);
    const canClose = cashRemaining >= netNeeded;
    const feeOffset = canClose ? availableFee : 0;
    const cashApplied = canClose ? netNeeded : Math.min(cashRemaining, row.receivableOutstanding);
    const grossCleared = cashApplied + feeOffset;
    if (grossCleared > 0) {
      allocations.push({
        ...row,
        cashApplied,
        feeOffset,
        grossCleared,
        fullySettled: grossCleared >= row.receivableOutstanding,
      });
    }
    cashRemaining -= cashApplied;
    if (cashRemaining === 0 && !canClose) break;
  }

  if (cashRemaining > 0) throw new Error('amount_exceeds_open');
  return allocations;
}
