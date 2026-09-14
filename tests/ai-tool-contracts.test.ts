import { describe, expect, it } from 'vitest';
import {
  PrepareInventoryAdjustmentSchema,
  PrepareDisposeReturnedGoodsSchema,
  PrepareDispatchStockTransferSchema,
  PrepareLocalExpenseSchema,
  PreparePackingSchema,
  PrepareReceiveStockTransferSchema,
  PrepareReceiveStockSchema,
  PrepareReturnToQuarantineSchema,
  PrepareReverseStockDocumentSchema,
  PrepareOrderSchema,
  PreparePurchaseSchema,
  PrepareRefundSchema,
  PrepareTransferSchema,
  ProductBuyersSchema,
  FinanceOverviewSchema,
  CustomerInsightsSchema,
  DemandForecastSchema,
  DeliverySummarySchema,
  RoasterySummarySchema,
  InventoryRecommendationsSchema,
  OperationalAlertsSchema,
} from '@/server/ai/schemas';
import {
  ResolvedInventoryAdjustmentActionSchema,
  ResolvedDisposeReturnedGoodsActionSchema,
  ResolvedDispatchStockTransferActionSchema,
  ResolvedLocalExpenseActionSchema,
  ResolvedOrderActionSchema,
  ResolvedPackingActionSchema,
  ResolvedRefundActionSchema,
  ResolvedReceiveStockTransferActionSchema,
  ResolvedReturnToQuarantineActionSchema,
  ResolvedReverseStockDocumentActionSchema,
  ResolvedTransferActionSchema,
  ResolvedStockReceiptActionSchema,
} from '@/server/ai/action-data';
import { AI_ASSISTANT_TOOLS } from '@/server/ai/tool-definitions';
import { actionPreconditionIssues } from '@/server/ai/preconditions';
import { documentKindForAction } from '@/server/ai/documents';
import { QuickOrderDraftSchema } from '@/lib/ai-quick-order';
import { compatibleCustomerMatches } from '@/server/commands/customers';
import { buildDemandForecast } from '@/lib/ai-demand-forecast';

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
    expect(AI_ASSISTANT_TOOLS).toHaveLength(37);
    expect(new Set(AI_ASSISTANT_TOOLS.map((tool) => tool.name)).size).toBe(AI_ASSISTANT_TOOLS.length);
    for (const tool of AI_ASSISTANT_TOOLS) {
      expect(tool.strict).toBe(true);
      expect(tool.parameters).toMatchObject({ type: 'object', additionalProperties: false });
    }
    expect(AI_ASSISTANT_TOOLS.some((tool) => tool.name.includes('delete'))).toBe(false);
    expect(AI_ASSISTANT_TOOLS.some((tool) => tool.name.includes('sql'))).toBe(false);
    expect(AI_ASSISTANT_TOOLS.some((tool) => tool.name === 'product_buyers')).toBe(true);
    expect(AI_ASSISTANT_TOOLS.some((tool) => tool.name === 'finance_overview')).toBe(true);
    expect(AI_ASSISTANT_TOOLS.some((tool) => tool.name === 'inventory_recommendations')).toBe(true);
    expect(AI_ASSISTANT_TOOLS.some((tool) => tool.name === 'demand_forecast')).toBe(true);
  });

  it('validates strict location-based receipt and packing payloads', () => {
    expect(PrepareReceiveStockSchema.parse({
      inventoryItemQuery: 'green coffee',
      locationQuery: 'central raw warehouse',
      quantity: 25.125,
      unitCost: 8_500,
      occurredAt: null,
      bestBefore: null,
      supplierLot: 'SUP-LOT-7',
      supplierQuery: 'Supplier One',
      newSupplier: null,
      paymentMode: 'CREDIT',
      accountQuery: null,
      dueDate: null,
      reference: null,
      notes: null,
    }).quantity).toBe(25.125);
    expect(() => PrepareReceiveStockSchema.parse({
      inventoryItemQuery: 'green coffee',
      locationQuery: null,
      quantity: 1,
      unitCost: 1,
      occurredAt: null,
      bestBefore: null,
      supplierLot: null,
      supplierQuery: 'Supplier One',
      newSupplier: null,
      paymentMode: 'CREDIT',
      accountQuery: null,
      dueDate: null,
      reference: null,
      notes: null,
      sql: 'select *',
    })).toThrow();
    expect(ResolvedStockReceiptActionSchema.safeParse({
      inventoryItemId: 'item',
      inventoryItemName: 'Green coffee',
      inventoryUnit: 'kg',
      locationId: 'raw',
      locationName: 'Raw warehouse',
      expectedLocationVersion: 1,
      quantity: 25.125,
      unitCost: 8_500,
      occurredAt: '2026-09-09T08:00:00.000Z',
      bestBefore: null,
      supplierLot: null,
      partyId: 'supplier',
      supplierName: 'Supplier One',
      newSupplier: null,
      paymentMode: 'CREDIT',
      accountId: null,
      accountName: null,
      dueDate: '2026-10-09T08:00:00.000Z',
      reference: null,
      notes: null,
      idempotencyKey: 'ai-receipt:message-1',
    }).success).toBe(true);
    expect(PreparePackingSchema.parse({
      outputInventoryItemQuery: 'SKU-1',
      locationQuery: 'packing',
      outputQuantity: 24,
      rejectedQuantity: 1,
      packedAt: null,
      bestBefore: null,
      notes: null,
    }).outputQuantity).toBe(24);
    expect(ResolvedPackingActionSchema.safeParse({
      locationId: 'packing',
      locationName: 'Packing',
      expectedLocationVersion: 1,
      productId: 'product',
      productName: 'Coffee',
      outputInventoryItemId: 'finished',
      outputInventoryItemName: 'Coffee 225 g',
      outputUnit: 'unit',
      recipeVersionId: 'recipe',
      recipeVersion: 2,
      outputQuantity: 24,
      rejectedQuantity: 1,
      packedAt: '2026-09-09T08:00:00.000Z',
      bestBefore: null,
      notes: null,
      idempotencyKey: 'ai-pack:message-1',
    }).success).toBe(true);
  });

  it('validates strict stock transfer dispatch and receipt payloads', () => {
    expect(PrepareDispatchStockTransferSchema.safeParse({
      sourceLocationQuery: 'central',
      destinationLocationQuery: 'sales point',
      lines: [{ inventoryItemQuery: 'SKU-1', quantity: 2.125 }],
      occurredAt: null,
      expectedAt: null,
      notes: null,
    }).success).toBe(true);
    expect(ResolvedDispatchStockTransferActionSchema.safeParse({
      sourceLocationId: 'source',
      sourceLocationName: 'Central',
      destinationLocationId: 'destination',
      destinationLocationName: 'Sales point',
      transitLocationId: 'transit',
      transitLocationName: 'In transit',
      expectedSourceVersion: 1,
      expectedTransitVersion: 2,
      lines: [{ inventoryItemId: 'item', inventoryItemName: 'Coffee', unit: 'unit', quantity: 2.125 }],
      occurredAt: '2026-09-09T08:00:00.000Z',
      expectedAt: null,
      notes: null,
      idempotencyKey: 'ai-transfer-dispatch:message-1',
    }).success).toBe(true);
    expect(PrepareReceiveStockTransferSchema.safeParse({
      transferQuery: 'STK-1',
      receiveAll: true,
      lines: null,
      discrepancies: [],
      occurredAt: null,
      notes: null,
    }).success).toBe(true);
    expect(ResolvedReceiveStockTransferActionSchema.safeParse({
      stockDocumentId: 'dispatch',
      transferNumber: 'STK-1',
      expectedDocumentVersion: 1,
      destinationLocationId: 'destination',
      destinationLocationName: 'Sales point',
      transitLocationId: 'transit',
      transitLocationName: 'In transit',
      expectedDestinationVersion: 3,
      expectedTransitVersion: 4,
      lines: [{ inventoryItemId: 'item', inventoryItemName: 'Coffee', unit: 'unit', quantity: 2 }],
      discrepancies: [],
      occurredAt: '2026-09-09T08:00:00.000Z',
      notes: null,
      idempotencyKey: 'ai-transfer-receive:message-2',
    }).success).toBe(true);
  });

  it('requires one trusted evidence source for a location-scoped local expense', () => {
    expect(PrepareLocalExpenseSchema.parse({
      locationQuery: 'Sales point A',
      amount: 25_000,
      categoryType: 'UTILITIES',
      description: 'Local electricity expense',
      occurredAt: null,
      noReceiptReason: 'Supplier did not issue a receipt',
    }).amount).toBe(25_000);

    const action = {
      userId: 'user-1',
      locationId: 'sales-point-a',
      locationName: 'Sales point A',
      expectedLocationVersion: 2,
      amount: 25_000,
      categoryType: 'UTILITIES' as const,
      description: 'Local electricity expense',
      occurredAt: '2026-09-09T08:00:00.000Z',
      financeAccountId: 'cash-a',
      financeAccountName: 'Sales point cash',
      receiptAttachmentId: null,
      receiptFileName: null,
      noReceiptReason: 'Supplier did not issue a receipt',
      willRequireReview: false,
      idempotencyKey: 'ai-local-expense:message-1',
    };
    expect(ResolvedLocalExpenseActionSchema.parse(action)).toEqual(action);
    expect(() => ResolvedLocalExpenseActionSchema.parse({
      ...action,
      receiptAttachmentId: 'attachment-1',
      receiptFileName: 'receipt.pdf',
    })).toThrow('expense_evidence_required');
    expect(() => ResolvedLocalExpenseActionSchema.parse({
      ...action,
      noReceiptReason: null,
    })).toThrow('expense_evidence_required');
    expect(() => PrepareLocalExpenseSchema.parse({
      locationQuery: null,
      amount: 25_000,
      categoryType: 'UTILITIES',
      description: 'Local electricity expense',
      occurredAt: null,
      noReceiptReason: null,
      accountId: 'untrusted-client-account',
    })).toThrow();
  });

  it('validates strict returned-goods and stock-reversal contracts', () => {
    expect(PrepareReturnToQuarantineSchema.parse({
      orderQuery: 'LHB-ORD-260909-0001',
      productQuery: 'SKU-1',
      quantity: 1.125,
      occurredAt: null,
      reason: 'Customer returned sealed packs',
    }).quantity).toBe(1.125);
    const returned = {
      orderId: 'order-1',
      orderNumber: 'LHB-ORD-260909-0001',
      orderLineId: 'line-1',
      productName: 'Coffee 225 g',
      sku: 'SKU-1',
      inventoryItemId: 'item-finished',
      inventoryItemName: 'Coffee 225 g',
      unit: 'unit',
      fulfillmentLocationId: 'sales-point',
      fulfillmentLocationName: 'Sales point',
      expectedFulfillmentVersion: 3,
      quarantineLocationId: 'quarantine',
      quarantineLocationName: 'Quarantine',
      expectedQuarantineVersion: 2,
      quantity: 1.125,
      occurredAt: '2026-09-09T08:00:00.000Z',
      reason: 'Customer returned sealed packs',
      idempotencyKey: 'ai-return:message-1',
    };
    expect(ResolvedReturnToQuarantineActionSchema.parse(returned)).toEqual(returned);
    expect(() => ResolvedReturnToQuarantineActionSchema.parse({
      ...returned,
      quarantineLocationId: returned.fulfillmentLocationId,
    })).toThrow('return_quarantine_same_location');

    expect(PrepareDisposeReturnedGoodsSchema.parse({
      returnQuery: 'LHB-RET-260909-0001',
      inventoryItemQuery: 'SKU-1',
      quantity: 1,
      disposition: 'RESTOCK',
      destinationLocationQuery: 'Finished warehouse',
      supplierQuery: null,
      occurredAt: null,
      reason: 'Inspection passed',
    }).disposition).toBe('RESTOCK');
    const disposition = {
      returnDocumentId: 'return-1',
      returnDocumentNumber: 'LHB-RET-260909-0001',
      expectedReturnDocumentVersion: 1,
      inventoryItemId: 'item-finished',
      inventoryItemName: 'Coffee 225 g',
      unit: 'unit',
      quarantineLocationId: 'quarantine',
      quarantineLocationName: 'Quarantine',
      expectedQuarantineVersion: 2,
      quantity: 1,
      disposition: 'RESTOCK' as const,
      destinationLocationId: 'finished-warehouse',
      destinationLocationName: 'Finished warehouse',
      expectedDestinationVersion: 4,
      supplierPartyId: null,
      supplierName: null,
      occurredAt: '2026-09-09T09:00:00.000Z',
      reason: 'Inspection passed',
      idempotencyKey: 'ai-return-disposition:message-2',
    };
    expect(ResolvedDisposeReturnedGoodsActionSchema.parse(disposition)).toEqual(disposition);
    expect(() => ResolvedDisposeReturnedGoodsActionSchema.parse({
      ...disposition,
      destinationLocationId: null,
    })).toThrow('return_destination_invalid');
    expect(() => ResolvedDisposeReturnedGoodsActionSchema.parse({
      ...disposition,
      destinationLocationName: null,
    })).toThrow('return_destination_incomplete');

    expect(PrepareReverseStockDocumentSchema.parse({
      documentQuery: 'LHB-STK-260909-0001',
      occurredAt: null,
      reason: 'Duplicate receipt confirmed by supervisor',
    }).documentQuery).toBe('LHB-STK-260909-0001');
    const reversal = {
      stockDocumentId: 'document-1',
      documentNumber: 'LHB-STK-260909-0001',
      documentType: 'PURCHASE_RECEIPT',
      expectedDocumentVersion: 2,
      expectedLocationVersions: [{
        locationId: 'raw-warehouse',
        locationName: 'Raw warehouse',
        stockVersion: 5,
      }],
      occurredAt: '2026-09-09T10:00:00.000Z',
      reason: 'Duplicate receipt confirmed by supervisor',
      idempotencyKey: 'ai-stock-reversal:message-3',
    };
    expect(ResolvedReverseStockDocumentActionSchema.parse(reversal)).toEqual(reversal);
    expect(() => ResolvedReverseStockDocumentActionSchema.parse({
      ...reversal,
      expectedLocationVersions: [
        reversal.expectedLocationVersions[0],
        reversal.expectedLocationVersions[0],
      ],
    })).toThrow('location_version_duplicate');
  });

  it('assigns persisted inventory PDFs to every returned-goods mutation', () => {
    expect(documentKindForAction('RETURN_TO_QUARANTINE')).toBe('INVENTORY_MOVEMENT');
    expect(documentKindForAction('DISPOSE_RETURNED_GOODS')).toBe('INVENTORY_MOVEMENT');
    expect(documentKindForAction('REVERSE_STOCK_DOCUMENT')).toBe('CHANGE_CONFIRMATION');
  });

  it('bounds governed cross-module analytics without accepting arbitrary query fields', () => {
    const range = { preset: 'this_month' as const, from: null, to: null };
    expect(FinanceOverviewSchema.parse({ range, view: 'ACCOUNTS', limit: 25 }).view).toBe('ACCOUNTS');
    expect(CustomerInsightsSchema.parse({ range, dimension: 'TOP_CUSTOMERS', limit: 25 }).dimension).toBe('TOP_CUSTOMERS');
    expect(DeliverySummarySchema.parse({ range, dimension: 'COURIER', slaDays: 3, limit: 25 }).slaDays).toBe(3);
    expect(RoasterySummarySchema.parse({ range, dimension: 'BATCH', limit: 25 }).dimension).toBe('BATCH');
    expect(InventoryRecommendationsSchema.parse({ query: null, horizonDays: 30, limit: 25 }).horizonDays).toBe(30);
    expect(DemandForecastSchema.parse({ lookbackDays: 60, horizonDays: 30, limit: 25 }).lookbackDays).toBe(60);
    expect(OperationalAlertsSchema.parse({ expiryDays: 21, limit: 25 }).expiryDays).toBe(21);
    expect(() => FinanceOverviewSchema.parse({ range, view: 'ACCOUNTS', limit: 25, sql: 'select *' })).toThrow();
    expect(() => InventoryRecommendationsSchema.parse({ query: null, horizonDays: 365, limit: 25 })).toThrow();
    expect(() => DemandForecastSchema.parse({ lookbackDays: 7, horizonDays: 30, limit: 25 })).toThrow();
  });

  it('builds a transparent recent-versus-prior demand forecast', () => {
    const line = (productId: string, sku: string, quantity: number) => ({
      productId,
      sku,
      quantity,
      product: { nameEn: productId, nameAr: productId },
    });
    const forecast = buildDemandForecast({
      previous: [line('coffee', 'COFFEE-1', 14)],
      recent: [line('coffee', 'COFFEE-1', 28), line('new', 'NEW-1', 7)],
      previousDays: 14,
      recentDays: 14,
      horizonDays: 7,
    });

    expect(forecast[0]).toMatchObject({
      productId: 'coffee',
      previousUnits: 14,
      recentUnits: 28,
      trendPct: 1,
      forecastUnits: 15,
      confidence: 'HIGH',
    });
    expect(forecast[1]).toMatchObject({ productId: 'new', trendPct: null, forecastUnits: 4, confidence: 'MEDIUM' });
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
