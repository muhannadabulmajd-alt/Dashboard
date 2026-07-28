export type CanonicalSpendTreatment = 'CAPEX' | 'INVENTORY' | 'OPEX' | 'REVIEW';
export type CanonicalClassificationStatus = 'CONFIRMED' | 'NEEDS_REVIEW';

export function spendTreatmentForItemType(itemType: string): CanonicalSpendTreatment {
  if (itemType === 'ASSET') return 'CAPEX';
  if (itemType === 'INVENTORY') return 'INVENTORY';
  if (itemType === 'EXPENSE' || itemType === 'SERVICE') return 'OPEX';
  return 'REVIEW';
}

export function classificationStatusForTreatment(
  treatment: CanonicalSpendTreatment,
): CanonicalClassificationStatus {
  return treatment === 'REVIEW' ? 'NEEDS_REVIEW' : 'CONFIRMED';
}
