import { describe, expect, it } from 'vitest';
import { can } from '@/lib/rbac';
import {
  localExpenseAccountMatchesLocation,
  localExpenseRequiresReview,
} from '@/server/inventory-v2/local-expense-policy';
import { validateLocalExpenseReceipt } from '@/server/inventory-v2/local-expenses';
import {
  LocationExpensePolicySchema,
  RecordLocalExpenseCommandSchema,
  ReviewLocalExpenseCommandSchema,
} from '@/server/inventory-v2/schemas';

const base = {
  locationId: 'sales-point-a',
  amount: 25_000,
  categoryType: 'UTILITIES' as const,
  description: 'Local electricity expense',
  occurredAt: new Date('2026-09-08T00:00:00.000Z'),
  idempotencyKey: 'local-expense:test:0001',
  expectedLocationVersion: 1,
};

const policy = {
  isActive: true,
  allowedCategories: ['UTILITIES', 'RENT'],
  maxImmediateAmount: 100_000,
  receiptRequiredAbove: 50_000,
};

describe('Inventory V2 local expense contracts', () => {
  it('accepts exactly one evidence source and routine Opex only', () => {
    expect(RecordLocalExpenseCommandSchema.safeParse({
      ...base,
      noReceiptReason: 'Supplier did not issue a receipt',
    }).success).toBe(true);
    expect(RecordLocalExpenseCommandSchema.safeParse({
      ...base,
      receipt: {
        bytes: new TextEncoder().encode('%PDF-1.7 receipt'),
        fileName: 'receipt.pdf',
        declaredMimeType: 'application/pdf',
      },
    }).success).toBe(true);
    expect(RecordLocalExpenseCommandSchema.safeParse(base).success).toBe(false);
    expect(RecordLocalExpenseCommandSchema.safeParse({
      ...base,
      receipt: { bytes: new Uint8Array([0xff, 0xd8, 0xff]), fileName: 'receipt.jpg' },
      noReceiptReason: 'Duplicate evidence must fail',
    }).success).toBe(false);
    expect(RecordLocalExpenseCommandSchema.safeParse({
      ...base,
      categoryType: 'GREEN_COFFEE',
      noReceiptReason: 'Must use the inventory purchase workflow',
    }).success).toBe(false);
    expect(RecordLocalExpenseCommandSchema.safeParse({
      ...base,
      categoryType: 'EQUIPMENT',
      noReceiptReason: 'Must use the capital workflow',
    }).success).toBe(false);
  });

  it('routes policy exceptions to central review', () => {
    expect(localExpenseRequiresReview(policy, {
      amount: 25_000,
      categoryType: 'UTILITIES',
      hasReceipt: false,
    })).toBe(false);
    expect(localExpenseRequiresReview(policy, {
      amount: 75_000,
      categoryType: 'UTILITIES',
      hasReceipt: false,
    })).toBe(true);
    expect(localExpenseRequiresReview(policy, {
      amount: 75_000,
      categoryType: 'UTILITIES',
      hasReceipt: true,
    })).toBe(false);
    expect(localExpenseRequiresReview(policy, {
      amount: 125_000,
      categoryType: 'UTILITIES',
      hasReceipt: true,
    })).toBe(true);
    expect(localExpenseRequiresReview(policy, {
      amount: 10_000,
      categoryType: 'MARKETING',
      hasReceipt: true,
    })).toBe(true);
    expect(localExpenseRequiresReview(null, {
      amount: 1,
      categoryType: 'UTILITIES',
      hasReceipt: true,
    })).toBe(true);
  });

  it('accepts only an active IQD account assigned to the exact location', () => {
    const location = { id: 'sales-point-a', branchId: 'branch-a' };
    const baseAccount = {
      isActive: true,
      currency: 'IQD',
      type: 'CASH',
      branchId: 'branch-a',
      stockLocationId: null,
    };
    expect(localExpenseAccountMatchesLocation(baseAccount, location)).toBe(false);
    expect(localExpenseAccountMatchesLocation({
      ...baseAccount,
      stockLocationId: 'sales-point-a',
    }, location)).toBe(true);
    expect(localExpenseAccountMatchesLocation({
      ...baseAccount,
      branchId: null,
      stockLocationId: 'sales-point-a',
    }, location)).toBe(true);
    expect(localExpenseAccountMatchesLocation({ ...baseAccount, branchId: 'branch-b' }, location)).toBe(false);
    expect(localExpenseAccountMatchesLocation({ ...baseAccount, stockLocationId: 'sales-point-b' }, location)).toBe(false);
    expect(localExpenseAccountMatchesLocation({ ...baseAccount, currency: 'USD' }, location)).toBe(false);
    expect(localExpenseAccountMatchesLocation({ ...baseAccount, type: 'PAYMENT_GATEWAY' }, location)).toBe(false);
    expect(localExpenseAccountMatchesLocation({ ...baseAccount, isActive: false }, location)).toBe(false);
  });

  it('validates policy and review versions and decisions', () => {
    expect(LocationExpensePolicySchema.safeParse({
      locationId: 'sales-point-a',
      isActive: true,
      allowedCategories: ['UTILITIES'],
      maxImmediateAmount: 100_000,
      receiptRequiredAbove: 25_000,
      expectedLocationVersion: 1,
    }).success).toBe(true);
    expect(LocationExpensePolicySchema.safeParse({
      locationId: 'sales-point-a',
      isActive: true,
      allowedCategories: [],
      maxImmediateAmount: 100_000,
      receiptRequiredAbove: 25_000,
      expectedLocationVersion: 1,
    }).success).toBe(false);
    expect(ReviewLocalExpenseCommandSchema.safeParse({
      requestId: 'request-a',
      decision: 'APPROVE',
      reason: 'Receipt and amount verified',
      occurredAt: base.occurredAt,
      idempotencyKey: 'local-expense-review:test:0001',
      expectedRequestVersion: 1,
      expectedLocationVersion: 1,
    }).success).toBe(true);
    expect(ReviewLocalExpenseCommandSchema.safeParse({
      requestId: 'request-a',
      decision: 'POST',
      reason: 'Invalid decision',
      occurredAt: base.occurredAt,
      idempotencyKey: 'local-expense-review:test:0001',
      expectedRequestVersion: 1,
      expectedLocationVersion: 1,
    }).success).toBe(false);
  });

  it('rejects audio evidence even though AI voice attachments are supported elsewhere', () => {
    expect(() => validateLocalExpenseReceipt({
      bytes: new TextEncoder().encode('OggSvoice'),
      fileName: 'voice.ogg',
      declaredMimeType: 'audio/ogg',
    })).toThrow('expense_receipt_type_unsupported');
    expect(validateLocalExpenseReceipt({
      bytes: new TextEncoder().encode('%PDF-1.7 receipt'),
      fileName: '../../receipt.jpg',
      declaredMimeType: 'application/pdf',
    })).toMatchObject({
      mimeType: 'application/pdf',
      fileName: '..-..-receipt.pdf',
    });
  });

  it('grants a branch manager only the narrow expense capability', () => {
    expect(can('BRANCH_MANAGER', 'record:local-expense')).toBe(true);
    expect(can('BRANCH_MANAGER', 'manage:finance')).toBe(false);
    expect(can('BRANCH_MANAGER', 'view:finance')).toBe(false);
    expect(can('OWNER', 'record:local-expense')).toBe(true);
  });
});
