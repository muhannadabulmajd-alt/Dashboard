export const OPENING_COUNT_ATTESTATION =
  'I attest that every active inventory item at this location was physically counted, including zero balances.';

export type OpeningCountCoverage = {
  missingItemIds: string[];
  unexpectedItemIds: string[];
  complete: boolean;
};

export function openingCountCoverage(
  activePolicyItemIds: readonly string[],
  submittedItemIds: readonly string[],
): OpeningCountCoverage {
  const active = new Set(activePolicyItemIds);
  const submitted = new Set(submittedItemIds);
  const missingItemIds = [...active].filter((itemId) => !submitted.has(itemId)).sort();
  const unexpectedItemIds = [...submitted].filter((itemId) => !active.has(itemId)).sort();
  return {
    missingItemIds,
    unexpectedItemIds,
    complete: missingItemIds.length === 0 && unexpectedItemIds.length === 0,
  };
}

export function inventoryCountPostingType(kind: 'ROUTINE' | 'OPENING') {
  return kind === 'OPENING'
    ? { documentType: 'OPENING' as const, movementReason: 'OPENING' as const }
    : { documentType: 'ADJUSTMENT' as const, movementReason: 'ADJUSTMENT' as const };
}

export function hasValidPositiveAdjustmentCost(difference: number, unitCost: number | null): boolean {
  return difference <= 0 || (unitCost !== null && Number.isFinite(unitCost) && unitCost > 0);
}
