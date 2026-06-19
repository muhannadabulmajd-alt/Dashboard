import { describe, expect, it } from 'vitest';
import { ledgerRecordClassForLines, ledgerRecordClassLabel } from '@/lib/ledger-record-class';

describe('ledger record classification', () => {
  it('classifies purchase, expense, and mixed invoices from their lines', () => {
    expect(ledgerRecordClassForLines([{ itemType: 'INVENTORY' }, { itemType: 'ASSET' }])).toBe('PURCHASE');
    expect(ledgerRecordClassForLines([{ itemType: 'EXPENSE' }, { itemType: 'SERVICE' }])).toBe('EXPENSE');
    expect(ledgerRecordClassForLines([{ itemType: 'INVENTORY' }, { itemType: 'EXPENSE' }])).toBe('MIXED');
  });

  it('provides simple bilingual labels', () => {
    expect(ledgerRecordClassLabel('MIXED', 'en')).toBe('Purchase + expense');
    expect(ledgerRecordClassLabel('MIXED', 'ar')).toBe('شراء + مصروف');
  });
});
