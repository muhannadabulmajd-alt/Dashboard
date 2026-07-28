import { describe, expect, it } from 'vitest';
import {
  classificationStatusForTreatment,
  spendTreatmentForItemType,
} from '@/lib/spend-treatment';

describe('canonical spend treatment', () => {
  it('maps every supported ledger line to exactly one accounting treatment', () => {
    expect(spendTreatmentForItemType('ASSET')).toBe('CAPEX');
    expect(spendTreatmentForItemType('INVENTORY')).toBe('INVENTORY');
    expect(spendTreatmentForItemType('EXPENSE')).toBe('OPEX');
    expect(spendTreatmentForItemType('SERVICE')).toBe('OPEX');
    expect(spendTreatmentForItemType('OTHER')).toBe('REVIEW');
  });

  it('keeps unresolved classifications visible for review', () => {
    expect(classificationStatusForTreatment('CAPEX')).toBe('CONFIRMED');
    expect(classificationStatusForTreatment('INVENTORY')).toBe('CONFIRMED');
    expect(classificationStatusForTreatment('OPEX')).toBe('CONFIRMED');
    expect(classificationStatusForTreatment('REVIEW')).toBe('NEEDS_REVIEW');
  });
});
