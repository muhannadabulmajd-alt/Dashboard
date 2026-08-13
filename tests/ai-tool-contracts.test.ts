import { describe, expect, it } from 'vitest';
import { PrepareOrderSchema, PreparePurchaseSchema } from '@/server/ai/schemas';
import { ResolvedOrderActionSchema } from '@/server/ai/action-data';
import { AI_ASSISTANT_TOOLS } from '@/server/ai/tool-definitions';
import { actionPreconditionIssues } from '@/server/ai/preconditions';
import { QuickOrderDraftSchema } from '@/lib/ai-quick-order';

describe('AI write tool validation', () => {
  it('accepts a bounded guided order draft and rejects unsafe extras', () => {
    const draft = {
      locale: 'en' as const,
      customerExternalId: null,
      placedAt: '2026-08-13',
      channel: 'WHATSAPP',
      governorate: 'BAGHDAD',
      fulfillmentMethod: 'PICKUP' as const,
      status: 'PENDING',
      notes: null,
      lines: [{ sku: 'LHB-TRK-CRD-225-TG-MD', quantity: 2 }],
    };
    expect(QuickOrderDraftSchema.parse(draft)).toEqual(draft);
    expect(() => QuickOrderDraftSchema.parse({ ...draft, sql: 'select *' })).toThrow();
    expect(() => QuickOrderDraftSchema.parse({ ...draft, lines: [{ ...draft.lines[0], quantity: 0 }] })).toThrow();
  });

  it('allows missing choice fields only at the extraction stage', () => {
    const extracted = PrepareOrderSchema.parse({
      customerQuery: null,
      newCustomer: null,
      placedAt: null,
      channel: null,
      governorate: null,
      fulfillmentMethod: null,
      status: null,
      deliveryFee: 0,
      deliveryCost: 0,
      orderDiscount: 0,
      extraCharges: 0,
      notes: null,
      financeMode: null,
      financeAccountQuery: null,
      financeProviderQuery: null,
      financePaidAmount: null,
      financePaymentMethod: null,
      financePaymentDate: null,
      financeDueDate: null,
      lines: [{ productQuery: 'Guji', quantity: 1, unitGrossPrice: null, lineDiscount: 0 }],
    });
    expect(extracted.financeMode).toBeNull();
    expect(() => ResolvedOrderActionSchema.parse({ ...extracted, lines: [] })).toThrow();
  });

  it('rejects unknown fields recursively in write tool input', () => {
    const base = {
      purchaseType: null,
      date: null,
      totalAmount: null,
      currency: null,
      rate: null,
      quantity: null,
      unit: null,
      inventoryItemQuery: null,
      newItemNameEn: null,
      newItemNameAr: null,
      newItemCategory: null,
      assetName: null,
      assetCategory: null,
      supplierQuery: null,
      paidMode: null,
      paidAmount: null,
      accountQuery: null,
      paymentMethod: null,
      paymentDate: null,
      dueDate: null,
      branchQuery: null,
      reference: null,
      notes: null,
    };
    expect(PreparePurchaseSchema.parse(base)).toEqual(base);
    expect(() => PreparePurchaseSchema.parse({ ...base, sql: 'DROP TABLE' })).toThrow();
  });

  it('publishes only strict allowlisted function schemas', () => {
    expect(AI_ASSISTANT_TOOLS).toHaveLength(11);
    expect(new Set(AI_ASSISTANT_TOOLS.map((tool) => tool.name)).size).toBe(AI_ASSISTANT_TOOLS.length);
    for (const tool of AI_ASSISTANT_TOOLS) {
      expect(tool.strict).toBe(true);
      expect(tool.parameters).toMatchObject({ type: 'object', additionalProperties: false });
    }
    expect(AI_ASSISTANT_TOOLS.some((tool) => tool.name.includes('delete'))).toBe(false);
    expect(AI_ASSISTANT_TOOLS.some((tool) => tool.name.includes('sql'))).toBe(false);
  });

  it('blocks inactive records and insufficient stock before order confirmation', () => {
    const raw = {
      customerExternalId: 'LHB-CUS-260101-0001',
      newCustomer: null,
      placedAt: '2026-08-13T09:00:00.000Z',
      channel: 'MANUAL',
      governorate: 'BAGHDAD',
      fulfillmentMethod: 'PICKUP',
      status: 'COMPLETED',
      deliveryFee: 0,
      deliveryCost: 0,
      orderDiscount: 0,
      extraCharges: 0,
      notes: null,
      financeMode: 'PAID',
      financeAccountId: 'cash',
      financeProviderId: null,
      financePaidAmount: null,
      financePaymentMethod: 'CASH',
      financePaymentDate: '2026-08-13T09:00:00.000Z',
      financeDueDate: null,
      lines: [{ productId: 'product', sku: 'LHB-TEST', quantity: 2, unitGrossPrice: 8_500, lineDiscount: 0 }],
    };
    const issues = actionPreconditionIssues('CREATE_ORDER', raw, {
      products: [{ id: 'product', sku: 'LHB-TEST', isActive: true, trackInventory: true, inventoryItems: ['stock'], availableQuantity: 1 }],
      customer: { isActive: false },
      account: { isActive: true },
      provider: null,
      status: { code: 'COMPLETED', role: 'SALE' },
      channel: { code: 'MANUAL', active: true },
      governorate: { code: 'BAGHDAD', active: true },
      fulfillment: { code: 'PICKUP', active: true },
    } as never);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'stock_insufficient' }),
      expect.objectContaining({ code: 'customer_inactive' }),
    ]));
  });
});
