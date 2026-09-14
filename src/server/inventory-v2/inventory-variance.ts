import { roundMoney } from '@/lib/decimal';

export type InventoryVarianceDirection = 'GAIN' | 'LOSS';

export type InventoryVarianceAllocation = {
  costLayerId: string;
  quantity: number;
  unitCost: number;
};

export type InventoryVarianceLinePlan = {
  direction: InventoryVarianceDirection;
  quantity: number;
  exactValue: number;
  lineTotal: number;
  averageUnitCost: number;
  allocations: InventoryVarianceAllocation[];
};

export type InventoryVariancePolicyLike = {
  isActive: boolean;
  openingBalanceAccountCode: string | null;
  inventoryGainAccountCode: string | null;
  inventoryLossAccountCode: string | null;
};

export function inventoryVarianceLedgerClassification(isOpeningBalance: boolean) {
  return {
    itemType: 'INVENTORY' as const,
    spendTreatment: isOpeningBalance ? 'INVENTORY' as const : 'OPEX' as const,
  };
}

function validNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function buildInventoryVarianceLinePlan(input: {
  difference: number;
  positiveUnitCost?: number | null;
  allocations?: InventoryVarianceAllocation[];
}): InventoryVarianceLinePlan | null {
  if (!Number.isFinite(input.difference)) throw new Error('count_variance_invalid');
  if (input.difference === 0) return null;

  const direction: InventoryVarianceDirection = input.difference > 0 ? 'GAIN' : 'LOSS';
  const quantity = Math.abs(input.difference);
  const allocations = input.allocations ?? [];
  let exactValue: number;

  if (direction === 'GAIN') {
    const unitCost = input.positiveUnitCost;
    if (unitCost === null || unitCost === undefined || !validNumber(unitCost) || unitCost <= 0) {
      throw new Error('adjustment_unit_cost_required');
    }
    exactValue = quantity * unitCost;
  } else {
    const allocatedQuantity = allocations.reduce((sum, row) => {
      if (!validNumber(row.quantity) || !validNumber(row.unitCost)) {
        throw new Error('count_variance_invalid');
      }
      return sum + row.quantity;
    }, 0);
    if (Math.abs(allocatedQuantity - quantity) > 0.0005) {
      throw new Error('count_variance_allocation_mismatch');
    }
    exactValue = allocations.reduce((sum, row) => sum + row.quantity * row.unitCost, 0);
  }

  return {
    direction,
    quantity,
    exactValue,
    lineTotal: roundMoney(exactValue),
    averageUnitCost: quantity > 0 ? exactValue / quantity : 0,
    allocations,
  };
}

export function varianceAccountCode(
  policy: InventoryVariancePolicyLike | null | undefined,
  countKind: 'ROUTINE' | 'OPENING',
  direction: InventoryVarianceDirection,
): string | null {
  if (!policy?.isActive) return null;
  const raw = countKind === 'OPENING'
    ? policy.openingBalanceAccountCode
    : direction === 'GAIN'
      ? policy.inventoryGainAccountCode
      : policy.inventoryLossAccountCode;
  const code = raw?.trim();
  return code || null;
}

export function inventoryVarianceOperatingAmount(
  type: 'INVENTORY_GAIN' | 'INVENTORY_LOSS',
  amount: number,
  isOpeningBalance: boolean,
): number {
  if (isOpeningBalance) return 0;
  return type === 'INVENTORY_GAIN' ? -amount : amount;
}
