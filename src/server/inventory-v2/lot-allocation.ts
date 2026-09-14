export type AvailableLot = {
  id: string;
  quantity: number;
  unitCost: number;
  receivedAt: Date;
  bestBefore: Date | null;
};

export type LotAllocation = {
  costLayerId: string;
  quantity: number;
  unitCost: number;
};

function lotOrder(left: AvailableLot, right: AvailableLot): number {
  if (left.bestBefore && right.bestBefore) {
    const expiry = left.bestBefore.getTime() - right.bestBefore.getTime();
    if (expiry !== 0) return expiry;
  } else if (left.bestBefore) {
    return -1;
  } else if (right.bestBefore) {
    return 1;
  }
  const received = left.receivedAt.getTime() - right.receivedAt.getTime();
  return received !== 0 ? received : left.id.localeCompare(right.id);
}

export function selectLotAllocations(
  lots: AvailableLot[],
  requiredQuantity: number,
): { allocations: LotAllocation[]; shortage: number } {
  let remaining = requiredQuantity;
  const allocations: LotAllocation[] = [];
  for (const lot of lots.filter((row) => row.quantity > 0).sort(lotOrder)) {
    if (remaining <= 0) break;
    const allocated = Math.min(lot.quantity, remaining);
    allocations.push({
      costLayerId: lot.id,
      quantity: Number(allocated.toFixed(3)),
      unitCost: lot.unitCost,
    });
    remaining = Number((remaining - allocated).toFixed(3));
  }
  return { allocations, shortage: Math.max(0, remaining) };
}
