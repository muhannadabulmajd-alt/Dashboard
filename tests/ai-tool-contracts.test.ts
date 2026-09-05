import { describe, expect, it } from 'vitest';
import {
  PrepareInventoryAdjustmentSchema,
  PrepareOrderSchema,
  PreparePurchaseSchema,
  PrepareRefundSchema,
  PrepareTransferSchema,
  ProductBuyersSchema,
} from '@/server/ai/schemas';
import {
  ResolvedInventoryAdjustmentActionSchema,
  ResolvedOrderActionSchema,
  ResolvedRefundActionSchema,
  ResolvedTransferActionSchema,
} from '@/server/ai/action-data';
import { AI_ASSISTANT_TOOLS } from '@/server/ai/tool-definitions';
import { actionPreconditionIssues } from '@/server/ai/preconditions';
import { QuickOrderDraftSchema } from '@/lib/ai-quick-order';
import { compatibleCustomerMatches } from '@/server/commands/customers';

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
      newSupplier: null,
      paidMode: null,
      paidAmount: null,
      accountQuery: null,
      paymentMethod: null,
      paymentDate: null,
      dueDate: null,
      branchQuery: null,
      reference: null,
      notes: null,
      lines: null,
    };
    expect(PreparePurchaseSchema.parse(base)).toEqual(base);
    expect(() => PreparePurchaseSchema.parse({ ...base, sql: 'DROP TABLE' })).toThrow();
  });

  it('accepts three-decimal multi-line purchases with explicit treatment data', () => {
    const input = {
      purchaseType: 'MIXED' as const,
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
      supplierQuery: 'Coffee equipment supplier',
      newSupplier: {
        name: 'Coffee equipment supplier',
        type: 'SUPPLIER' as const,
        phone: '+9647700000000',
        email: null,
        address: 'Baghdad',
        notes: null,
      },
      paidMode: 'PARTIAL' as const,
      paidAmount: 100_000,
      accountQuery: 'Cash',
      paymentMethod: 'CASH',
      paymentDate: null,
      dueDate: null,
      branchQuery: null,
      reference: 'SUP-TEST-1',
      notes: null,
      lines: [{
        itemType: 'INVENTORY' as const,
        itemName: 'Packaging bags',
        categoryType: 'PACKAGING' as const,
        assetKey: null,
        assetCategory: null,
        inventoryItemQuery: null,
        newItemNameEn: 'Packaging bags',
        newItemNameAr: 'أكياس تغليف',
        newItemCategory: 'PACKAGING' as const,
        unit: 'unit' as const,
        quantity: 125.375,
        unitCost: 1_000,
        discount: 0,
        extra: 5_000,
        branchQuery: null,
        notes: null,
      }],
    };
    expect(PreparePurchaseSchema.parse(input).lines?.[0].quantity).toBe(125.375);
  });

  it('publishes only strict allowlisted function schemas', () => {
    expect(AI_ASSISTANT_TOOLS).toHaveLength(22);
    expect(new Set(AI_ASSISTANT_TOOLS.map((tool) => tool.name)).size).toBe(AI_ASSISTANT_TOOLS.length);
    for (const tool of AI_ASSISTANT_TOOLS) {
      expect(tool.strict).toBe(true);
      expect(tool.parameters).toMatchObject({ type: 'object', additionalProperties: false });
    }
    expect(AI_ASSISTANT_TOOLS.some((tool) => tool.name.includes('delete'))).toBe(false);
    expect(AI_ASSISTANT_TOOLS.some((tool) => tool.name.includes('sql'))).toBe(false);
    expect(AI_ASSISTANT_TOOLS.some((tool) => tool.name === 'product_buyers')).toBe(true);
  });

  it('requires distinct accounts for a governed transfer', () => {
    const extracted = PrepareTransferSchema.parse({
      date: null,
      amount: 125_000,
      currency: null,
      rate: null,
      fromAccountQuery: 'Cash',
      toAccountQuery: 'Bank',
      description: null,
      reference: null,
    });
    expect(extracted.amount).toBe(125_000);
    const resolved = {
      date: '2026-09-05T09:00:00.000Z',
      amount: 125_000,
      currency: 'IQD' as const,
      rate: null,
      fromAccountId: 'cash',
      fromAccountName: 'Cash',
      toAccountId: 'bank',
      toAccountName: 'Bank',
      description: 'Cash deposit',
      reference: null,
    };
    expect(ResolvedTransferActionSchema.parse(resolved)).toEqual(resolved);
    expect(() => ResolvedTransferActionSchema.parse({ ...resolved, toAccountId: 'cash' })).toThrow();
    expect(actionPreconditionIssues('CREATE_TRANSFER', resolved, {
      fromAccount: { id: 'cash', isActive: true, currency: 'IQD', type: 'CASH' },
      toAccount: { id: 'bank', isActive: false, currency: 'IQD', type: 'BANK' },
    } as never)).toContainEqual({ field: 'toAccountQuery', code: 'account_inactive' });
  });

  it('keeps differently named customers separate even when they share a phone', () => {
    const existing = [{ id: 'customer-1', nameEn: null, nameAr: 'نور عبداللطيف' }];
    expect(compatibleCustomerMatches({ nameAr: 'نور عبداللطيف' }, existing)).toHaveLength(1);
    expect(compatibleCustomerMatches({ nameAr: 'سارة أحمد' }, existing)).toHaveLength(0);
  });

  it('validates governed operations without accepting raw query fields', () => {
    const adjustment = {
      inventoryItemQuery: 'Green coffee Brazil',
      targetQuantity: 12.375,
      occurredAt: null,
      reason: 'Verified physical count',
    };
    expect(PrepareInventoryAdjustmentSchema.parse(adjustment)).toEqual(adjustment);
    expect(ResolvedInventoryAdjustmentActionSchema.parse({
      inventoryItemId: 'item-1',
      inventoryItemName: 'Green coffee Brazil',
      targetQuantity: 12.375,
      occurredAt: '2026-09-05T09:00:00.000Z',
      reason: adjustment.reason,
    }).targetQuantity).toBe(12.375);
    expect(() => ResolvedInventoryAdjustmentActionSchema.parse({
      inventoryItemId: 'item-1',
      inventoryItemName: 'Green coffee Brazil',
      targetQuantity: 12.3755,
      occurredAt: '2026-09-05T09:00:00.000Z',
      reason: adjustment.reason,
    })).toThrow();
    expect(() => PrepareInventoryAdjustmentSchema.parse({ ...adjustment, sql: 'update inventory' })).toThrow();
  });

  it('requires complete high-risk refund data at execution time', () => {
    const extracted = {
      orderQuery: 'LHB-ORD-260905-WEB-0001',
      amount: 10_000,
      accountQuery: 'Cash',
      paymentMethod: 'CASH' as const,
      date: null,
      reason: 'Customer returned the order',
    };
    expect(PrepareRefundSchema.parse(extracted)).toEqual(extracted);
    const resolved = ResolvedRefundActionSchema.parse({
      orderId: 'order-1',
      orderNumber: extracted.orderQuery,
      amount: extracted.amount,
      accountId: 'account-1',
      accountName: 'Cash',
      paymentMethod: extracted.paymentMethod,
      date: '2026-09-05T09:00:00.000Z',
      reason: extracted.reason,
    });
    expect(resolved.orderNumber).toBe(extracted.orderQuery);
    expect(() => ResolvedRefundActionSchema.parse({ ...resolved, reason: '' })).toThrow();
  });

  it('requires a bounded product-buyer query and rejects raw query fields', () => {
    const input = {
      productQuery: 'LHB-DRP-BOX10-15G-DB-M',
      range: { preset: 'all' as const, from: null, to: null },
      limit: 25,
    };
    expect(ProductBuyersSchema.parse(input)).toEqual(input);
    expect(() => ProductBuyersSchema.parse({ ...input, sql: 'select * from orders' })).toThrow();
    expect(() => ProductBuyersSchema.parse({ ...input, limit: 100 })).toThrow();
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
