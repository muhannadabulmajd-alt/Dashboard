import { describe, expect, it } from 'vitest';
import {
  ResolvedDispatchStockTransferActionSchema,
  ResolvedDisposeReturnedGoodsActionSchema,
  ResolvedInventoryAdjustmentActionSchema,
  ResolvedLocalExpenseActionSchema,
  ResolvedOrderActionSchema,
  ResolvedPackingActionSchema,
  ResolvedReceiveStockTransferActionSchema,
  ResolvedReturnToQuarantineActionSchema,
  ResolvedReverseStockDocumentActionSchema,
  ResolvedRoastBatchActionSchema,
  ResolvedStockReceiptActionSchema,
} from '@/server/ai/action-data';
import { actionPreconditionIssues } from '@/server/ai/preconditions';

const adjustment = {
  inventoryItemId: 'item-green',
  inventoryItemName: 'Green coffee',
  targetQuantity: 12.375,
  occurredAt: '2026-09-09T08:00:00.000Z',
  reason: 'Verified physical count',
  locationId: 'location-roastery',
  locationName: 'Central roastery',
  expectedLocationVersion: 7,
  idempotencyKey: 'ai-count:message-1',
};

const roast = {
  batchNumber: 'ROAST-2026-0909-01',
  origin: 'Ethiopia',
  roastDate: '2026-09-09T08:00:00.000Z',
  roastLevel: 'MEDIUM',
  greenInputGrams: 10_000,
  roastedOutputGrams: 8_200,
  abnormalLossGrams: 100,
  qcScore: 87,
  qcNotes: 'Passed',
  greenInventoryItemId: 'item-green',
  roastedInventoryItemId: 'item-roasted',
  branchId: 'branch-central',
  locationId: 'location-roastery',
  locationName: 'Central roastery',
  expectedLocationVersion: 7,
  idempotencyKey: 'ai-roast:message-1',
};

const order = {
  customerExternalId: 'customer-1',
  newCustomer: null,
  customerEnrichment: null,
  placedAt: '2026-09-09T08:00:00.000Z',
  channel: 'POS',
  governorate: 'BAGHDAD',
  fulfillmentMethod: 'PICKUP',
  fulfillmentLocationId: 'location-sales-point',
  fulfillmentLocationName: 'Sales point',
  expectedLocationVersion: 4,
  status: 'PENDING',
  deliveryFee: 0,
  deliveryCost: 0,
  orderDiscount: 0,
  extraCharges: 0,
  notes: null,
  financeMode: 'NONE',
  financeAccountId: null,
  financeProviderId: null,
  financePaidAmount: null,
  financePaymentMethod: null,
  financePaymentDate: null,
  financeDueDate: null,
  lines: [{
    productId: 'product-1',
    sku: 'SKU-1',
    quantity: 3,
    unitGrossPrice: 10_000,
    lineDiscount: 0,
  }],
};

const orderPreconditions = {
  status: { active: true, role: 'OPEN' },
  products: [{
    id: 'product-1',
    sku: 'SKU-1',
    isActive: true,
    trackInventory: true,
    inventoryItems: ['item-finished'],
    availableQuantity: 1,
    effectiveSellingPrice: 10_000,
    allowPriceOverride: false,
    minSellingPrice: null,
    allowDiscount: true,
    locationConfigured: true,
  }],
  location: { id: 'location-sales-point', isActive: true, stockVersion: 4 },
  account: null,
  channel: { active: true },
  governorate: { active: true },
  fulfillment: { active: true },
  customer: { id: 'customer-1', isActive: true, nameEn: 'Customer', nameAr: null },
  possibleNewCustomerDuplicates: [],
  possibleCustomerEnrichmentDuplicates: [],
  automaticFinance: null,
};

const receipt = {
  inventoryItemId: 'item-green',
  inventoryItemName: 'Green coffee',
  inventoryUnit: 'kg',
  locationId: 'location-raw',
  locationName: 'Raw warehouse',
  expectedLocationVersion: 3,
  quantity: 25.125,
  unitCost: 8_500,
  occurredAt: '2026-09-09T08:00:00.000Z',
  bestBefore: '2027-09-09T08:00:00.000Z',
  supplierLot: 'SUP-LOT-7',
  partyId: 'supplier-1',
  supplierName: 'Supplier One',
  newSupplier: null,
  paymentMode: 'PAID',
  accountId: 'account-raw',
  accountName: 'Raw warehouse cash',
  dueDate: null,
  reference: 'GRN-7',
  notes: null,
  idempotencyKey: 'ai-receipt:message-1',
};

const receiptPreconditions = {
  item: { id: 'item-green', isActive: true, unit: 'kg' },
  locationPolicy: { isActive: true },
  location: {
    id: 'location-raw',
    isActive: true,
    stockVersion: 3,
    branchId: 'branch-central',
  },
  party: { id: 'supplier-1', isActive: true, type: 'SUPPLIER', name: 'Supplier One' },
  newSupplier: null,
  account: {
    id: 'account-raw',
    isActive: true,
    currency: 'IQD',
    type: 'CASH',
    branchId: 'branch-central',
    stockLocationId: 'location-raw',
  },
};

const packing = {
  locationId: 'location-packing',
  locationName: 'Packing room',
  expectedLocationVersion: 11,
  productId: 'product-1',
  productName: 'Coffee 225 g',
  outputInventoryItemId: 'item-finished',
  outputInventoryItemName: 'Coffee 225 g',
  outputUnit: 'unit',
  recipeVersionId: 'recipe-2',
  recipeVersion: 2,
  outputQuantity: 24,
  rejectedQuantity: 1,
  packedAt: '2026-09-09T08:00:00.000Z',
  bestBefore: '2027-03-09T08:00:00.000Z',
  notes: null,
  idempotencyKey: 'ai-pack:message-1',
};

const packingPreconditions = {
  location: { id: 'location-packing', isActive: true, stockVersion: 11 },
  outputItem: {
    id: 'item-finished',
    isActive: true,
    category: 'FINISHED_GOOD',
    unit: 'unit',
    productId: 'product-1',
    locationPolicy: { isActive: true, canSell: true },
  },
  recipe: {
    id: 'recipe-2',
    productId: 'product-1',
    version: 2,
    isActive: true,
    components: [{
      name: 'Coffee bag',
      inventoryItemId: 'item-bag',
      required: 25,
      available: 40,
      inventoryItemActive: true,
      locationPolicy: { isActive: true, canProduce: true },
    }],
  },
};

const dispatchTransfer = {
  sourceLocationId: 'location-central',
  sourceLocationName: 'Central warehouse',
  destinationLocationId: 'location-sales-point',
  destinationLocationName: 'Sales point',
  transitLocationId: 'location-transit',
  transitLocationName: 'Sales point transit',
  expectedSourceVersion: 5,
  expectedTransitVersion: 2,
  lines: [{
    inventoryItemId: 'item-finished',
    inventoryItemName: 'Coffee 225 g',
    unit: 'unit',
    quantity: 12,
  }],
  occurredAt: '2026-09-09T08:00:00.000Z',
  expectedAt: '2026-09-10T08:00:00.000Z',
  notes: null,
  idempotencyKey: 'ai-transfer-dispatch:message-1',
};

const dispatchPreconditions = {
  source: {
    id: 'location-central',
    branchId: 'branch-central',
    type: 'FINISHED_GOODS_WAREHOUSE',
    isActive: true,
    isSystem: false,
    stockVersion: 5,
  },
  destination: {
    id: 'location-sales-point',
    branchId: 'branch-sales-point',
    type: 'SALES_POINT',
    isActive: true,
    isSystem: false,
  },
  transit: {
    id: 'location-transit',
    branchId: 'branch-sales-point',
    type: 'IN_TRANSIT',
    isActive: true,
    isSystem: true,
    stockVersion: 2,
  },
  lines: [{
    item: { id: 'item-finished', isActive: true, unit: 'unit' },
    sourcePolicy: { isActive: true },
    destinationPolicy: { isActive: true },
    available: 20,
  }],
};

const receiveTransfer = {
  stockDocumentId: 'transfer-1',
  transferNumber: 'LHB-STK-260909-0001',
  expectedDocumentVersion: 1,
  destinationLocationId: 'location-sales-point',
  destinationLocationName: 'Sales point',
  transitLocationId: 'location-transit',
  transitLocationName: 'Sales point transit',
  expectedDestinationVersion: 3,
  expectedTransitVersion: 2,
  lines: [{
    inventoryItemId: 'item-finished',
    inventoryItemName: 'Coffee 225 g',
    unit: 'unit',
    quantity: 12,
  }],
  discrepancies: [],
  occurredAt: '2026-09-10T08:00:00.000Z',
  notes: null,
  idempotencyKey: 'ai-transfer-receive:message-2',
};

const receivePreconditions = {
  document: {
    id: 'transfer-1',
    documentNumber: 'LHB-STK-260909-0001',
    type: 'TRANSFER',
    status: 'DISPATCHED',
    version: 1,
    destinationLocationId: 'location-sales-point',
  },
  destination: {
    id: 'location-sales-point',
    branchId: 'branch-sales-point',
    isActive: true,
    isSystem: false,
    stockVersion: 3,
  },
  transit: {
    id: 'location-transit',
    branchId: 'branch-sales-point',
    type: 'IN_TRANSIT',
    isActive: true,
    isSystem: true,
    stockVersion: 2,
  },
  outstanding: { 'item-finished': 12 },
  items: [{
    inventoryItemId: 'item-finished',
    item: { id: 'item-finished', isActive: true, unit: 'unit' },
    destinationPolicy: { isActive: true },
  }],
};

const localExpense = {
  userId: 'user-sales-point',
  locationId: 'location-sales-point',
  locationName: 'Sales point',
  expectedLocationVersion: 3,
  amount: 25_000,
  categoryType: 'UTILITIES' as const,
  description: 'Local electricity expense',
  occurredAt: '2026-09-10T08:00:00.000Z',
  financeAccountId: 'account-sales-point',
  financeAccountName: 'Sales point cash',
  receiptAttachmentId: 'attachment-receipt',
  receiptFileName: 'receipt.pdf',
  noReceiptReason: null,
  willRequireReview: false,
  idempotencyKey: 'ai-local-expense:message-3',
};

const localExpensePreconditions = {
  user: {
    id: 'user-sales-point',
    isActive: true,
    defaultFinanceAccountId: 'account-sales-point',
  },
  location: {
    id: 'location-sales-point',
    branchId: 'branch-sales-point',
    isActive: true,
    isSystem: false,
    stockVersion: 3,
  },
  account: {
    id: 'account-sales-point',
    name: 'Sales point cash',
    isActive: true,
    currency: 'IQD',
    type: 'CASH',
    branchId: 'branch-sales-point',
    stockLocationId: 'location-sales-point',
  },
  policy: {
    isActive: true,
    allowedCategories: ['UTILITIES'],
    maxImmediateAmount: 100_000,
    receiptRequiredAbove: 50_000,
  },
  attachment: {
    id: 'attachment-receipt',
    userId: 'user-sales-point',
    kind: 'DOCUMENT',
    status: 'READY',
    fileName: 'receipt.pdf',
    expiresAt: new Date('2099-09-11T08:00:00.000Z'),
  },
};

const returnedGoods = {
  orderId: 'order-1',
  orderNumber: 'LHB-ORD-260909-0001',
  orderLineId: 'order-line-1',
  productName: 'Coffee 225 g',
  sku: 'SKU-1',
  inventoryItemId: 'item-finished',
  inventoryItemName: 'Coffee 225 g',
  unit: 'unit',
  fulfillmentLocationId: 'location-sales-point',
  fulfillmentLocationName: 'Sales point',
  expectedFulfillmentVersion: 3,
  quarantineLocationId: 'location-quarantine',
  quarantineLocationName: 'Quarantine',
  expectedQuarantineVersion: 2,
  quantity: 1.5,
  occurredAt: '2026-09-10T09:00:00.000Z',
  reason: 'Customer returned sealed packs',
  idempotencyKey: 'ai-return:message-4',
};

const returnedGoodsPreconditions = {
  orderLine: {
    id: 'order-line-1',
    orderId: 'order-1',
    sku: 'SKU-1',
    order: {
      orderNumber: 'LHB-ORD-260909-0001',
      fulfillmentLocationId: 'location-sales-point',
    },
  },
  fulfillment: {
    id: 'location-sales-point',
    branchId: 'branch-sales-point',
    isActive: true,
    isSystem: false,
    stockVersion: 3,
  },
  quarantine: {
    id: 'location-quarantine',
    branchId: 'branch-sales-point',
    isActive: true,
    isSystem: true,
    stockVersion: 2,
  },
  inventoryItemIds: ['item-finished'],
  soldQuantity: 3,
  returnedQuantity: 1,
  returnableQuantity: 2,
};

const returnDisposition = {
  returnDocumentId: 'return-document-1',
  returnDocumentNumber: 'LHB-RET-260910-0001',
  expectedReturnDocumentVersion: 1,
  inventoryItemId: 'item-finished',
  inventoryItemName: 'Coffee 225 g',
  unit: 'unit',
  quarantineLocationId: 'location-quarantine',
  quarantineLocationName: 'Quarantine',
  expectedQuarantineVersion: 2,
  quantity: 1,
  disposition: 'RESTOCK' as const,
  destinationLocationId: 'location-finished',
  destinationLocationName: 'Finished warehouse',
  expectedDestinationVersion: 4,
  supplierPartyId: null,
  supplierName: null,
  occurredAt: '2026-09-10T10:00:00.000Z',
  reason: 'Inspection passed',
  idempotencyKey: 'ai-return-disposition:message-5',
};

const returnDispositionPreconditions = {
  returned: {
    document: {
      id: 'return-document-1',
      documentNumber: 'LHB-RET-260910-0001',
      version: 1,
      destinationLocationId: 'location-quarantine',
      branchId: 'branch-sales-point',
    },
  },
  item: {
    id: 'item-finished',
    nameEn: 'Coffee 225 g',
    nameAr: 'قهوة 225 غرام',
    unit: 'unit',
    isActive: true,
  },
  quarantine: {
    id: 'location-quarantine',
    branchId: 'branch-sales-point',
    type: 'QUARANTINE',
    isActive: true,
    isSystem: true,
    stockVersion: 2,
  },
  destination: {
    id: 'location-finished',
    branchId: 'branch-sales-point',
    type: 'FINISHED_WAREHOUSE',
    isActive: true,
    isSystem: false,
    stockVersion: 4,
    policies: [{ isActive: true, canSell: true, canProduce: false }],
  },
  supplier: null,
  variancePolicy: null,
  availableQuantity: 1.5,
};

const stockReversal = {
  stockDocumentId: 'stock-document-1',
  documentNumber: 'LHB-STK-260910-0001',
  documentType: 'PURCHASE_RECEIPT',
  expectedDocumentVersion: 2,
  expectedLocationVersions: [{
    locationId: 'location-raw',
    locationName: 'Raw warehouse',
    stockVersion: 5,
  }],
  occurredAt: '2026-09-10T11:00:00.000Z',
  reason: 'Duplicate receipt confirmed by supervisor',
  idempotencyKey: 'ai-stock-reversal:message-6',
};

const stockReversalPreconditions = {
  document: {
    id: 'stock-document-1',
    documentNumber: 'LHB-STK-260910-0001',
    type: 'PURCHASE_RECEIPT',
    status: 'CONFIRMED',
    version: 2,
    parentDocument: null,
    childDocuments: [],
    discrepancies: [],
    discrepancyResolutions: [],
    inventoryCount: null,
    reversedByDocument: null,
  },
  locations: [{ id: 'location-raw', isActive: true, stockVersion: 5 }],
  outputReversible: true,
  financeReversible: true,
};

describe('Inventory V2 AI mutation contracts', () => {
  it('requires complete location context for a physical count', () => {
    expect(ResolvedInventoryAdjustmentActionSchema.parse(adjustment)).toEqual(adjustment);
    expect(() => ResolvedInventoryAdjustmentActionSchema.parse({
      ...adjustment,
      expectedLocationVersion: undefined,
    })).toThrow('inventory_v2_location_context_incomplete');
  });

  it('detects a stale count location and an unconfigured item before confirmation', () => {
    expect(actionPreconditionIssues('ADJUST_INVENTORY', adjustment, {
      item: { id: 'item-green', isActive: true },
      currentQuantity: 10,
      location: { id: 'location-roastery', isActive: true, stockVersion: 8 },
      locationPolicy: null,
    } as never)).toEqual(expect.arrayContaining([
      { field: 'locationQuery', code: 'location_stale' },
      { field: 'inventoryItemQuery', code: 'inventory_location_not_configured' },
    ]));
  });

  it('accepts a fully scoped production preview and rejects impossible abnormal loss', () => {
    expect(ResolvedRoastBatchActionSchema.parse(roast)).toEqual(roast);
    expect(actionPreconditionIssues('CREATE_ROAST_BATCH', roast, {
      existing: null,
      green: { id: 'item-green', isActive: true, category: 'GREEN_COFFEE', unit: 'g' },
      roasted: { id: 'item-roasted', isActive: true, category: 'ROASTED', unit: 'g' },
      greenAvailable: 20_000,
      greenLocationPolicy: { isActive: true, canProduce: true },
      roastedLocationPolicy: { isActive: true, canProduce: true },
      branch: null,
      location: { id: 'location-roastery', isActive: true, stockVersion: 7, branchId: 'branch-central' },
    } as never)).toEqual([]);
    expect(() => ResolvedRoastBatchActionSchema.parse({
      ...roast,
      abnormalLossGrams: 1_900,
    })).toThrow('abnormal_loss_exceeds_shrinkage');
  });

  it('requires complete location context for an Inventory V2 order', () => {
    expect(ResolvedOrderActionSchema.parse(order)).toEqual(order);
    expect(() => ResolvedOrderActionSchema.parse({
      ...order,
      expectedLocationVersion: undefined,
    })).toThrow('inventory_v2_location_context_incomplete');
  });

  it('allows a local shortage to become a pending replenishment order', () => {
    expect(actionPreconditionIssues('CREATE_ORDER', order, orderPreconditions as never)).toEqual([]);
  });

  it('blocks stale, unconfigured, and account-mismatched order locations', () => {
    expect(actionPreconditionIssues('CREATE_ORDER', {
      ...order,
      financeMode: 'PAID',
      financeAccountId: 'account-other-location',
      financePaymentDate: '2026-09-09T08:00:00.000Z',
    }, {
      ...orderPreconditions,
      location: { id: 'location-sales-point', isActive: true, stockVersion: 5 },
      account: {
        id: 'account-other-location',
        isActive: true,
        currency: 'IQD',
        type: 'CASH',
        stockLocationId: 'location-other',
      },
      products: orderPreconditions.products.map((product) => ({
        ...product,
        locationConfigured: false,
      })),
    } as never)).toEqual(expect.arrayContaining([
      { field: 'lines', code: 'stock_location_not_sellable', detail: 'SKU-1' },
      { field: 'locationQuery', code: 'location_stale' },
      { field: 'financeAccountQuery', code: 'account_location_mismatch' },
    ]));
  });

  it('accepts a current, location-scoped stock receipt', () => {
    expect(ResolvedStockReceiptActionSchema.parse(receipt)).toEqual(receipt);
    expect(actionPreconditionIssues('RECEIVE_STOCK', receipt, receiptPreconditions as never)).toEqual([]);
  });

  it('blocks receipt version drift, account mismatch, and ambiguous new suppliers', () => {
    const newSupplierReceipt = {
      ...receipt,
      partyId: null,
      supplierName: 'New Supplier',
      newSupplier: {
        name: 'New Supplier',
        type: 'SUPPLIER',
        openingPayable: 0,
        openingReceivable: 0,
        netFeesFromRemittance: false,
        collectsOrderPayments: false,
      },
    };
    expect(actionPreconditionIssues('RECEIVE_STOCK', newSupplierReceipt, {
      ...receiptPreconditions,
      location: { ...receiptPreconditions.location, stockVersion: 4 },
      party: null,
      newSupplier: { matches: [{ id: 'supplier-a' }, { id: 'supplier-b' }] },
      account: { ...receiptPreconditions.account, stockLocationId: 'location-other' },
    } as never)).toEqual(expect.arrayContaining([
      { field: 'locationQuery', code: 'location_stale' },
      { field: 'supplierQuery', code: 'party_match_ambiguous' },
      { field: 'accountQuery', code: 'account_location_mismatch' },
    ]));
  });

  it('accepts a current packing run with sufficient producible materials', () => {
    expect(ResolvedPackingActionSchema.parse(packing)).toEqual(packing);
    expect(actionPreconditionIssues('PACK_FINISHED_GOODS', packing, packingPreconditions as never)).toEqual([]);
  });

  it('blocks stale recipes and insufficient packing components', () => {
    expect(actionPreconditionIssues('PACK_FINISHED_GOODS', packing, {
      ...packingPreconditions,
      recipe: {
        ...packingPreconditions.recipe,
        version: 3,
        components: packingPreconditions.recipe.components.map((component) => ({
          ...component,
          available: 20,
        })),
      },
    } as never)).toEqual(expect.arrayContaining([
      { field: 'outputInventoryItemQuery', code: 'packing_recipe_stale' },
      {
        field: 'outputQuantity',
        code: 'stock_insufficient',
        detail: 'Coffee bag:20:25',
      },
    ]));
  });

  it('accepts a current transfer dispatch and blocks source drift or shortages', () => {
    expect(ResolvedDispatchStockTransferActionSchema.parse(dispatchTransfer)).toEqual(dispatchTransfer);
    expect(actionPreconditionIssues('DISPATCH_STOCK_TRANSFER', dispatchTransfer, dispatchPreconditions as never)).toEqual([]);
    expect(actionPreconditionIssues('DISPATCH_STOCK_TRANSFER', dispatchTransfer, {
      ...dispatchPreconditions,
      source: { ...dispatchPreconditions.source, stockVersion: 6 },
      lines: [{
        ...dispatchPreconditions.lines[0],
        destinationPolicy: null,
        available: 10,
      }],
    } as never)).toEqual(expect.arrayContaining([
      { field: 'sourceLocationQuery', code: 'location_stale' },
      { field: 'lines.0.inventoryItemQuery', code: 'transfer_destination_item_not_configured' },
      {
        field: 'lines.0.quantity',
        code: 'stock_insufficient',
        detail: 'Coffee 225 g:10:12',
      },
    ]));
  });

  it('accepts a current transfer receipt and blocks stale or excessive receipts', () => {
    expect(ResolvedReceiveStockTransferActionSchema.parse(receiveTransfer)).toEqual(receiveTransfer);
    expect(actionPreconditionIssues('RECEIVE_STOCK_TRANSFER', receiveTransfer, receivePreconditions as never)).toEqual([]);
    expect(actionPreconditionIssues('RECEIVE_STOCK_TRANSFER', {
      ...receiveTransfer,
      lines: [{ ...receiveTransfer.lines[0], quantity: 13 }],
    }, {
      ...receivePreconditions,
      document: { ...receivePreconditions.document, version: 2 },
      items: [{ ...receivePreconditions.items[0], destinationPolicy: null }],
    } as never)).toEqual(expect.arrayContaining([
      { field: 'transferQuery', code: 'document_stale' },
      { field: 'lines.0.inventoryItemQuery', code: 'transfer_destination_item_not_configured' },
      { field: 'lines.0.quantity', code: 'transfer_receipt_exceeds_dispatch' },
    ]));
  });

  it('accepts a current local expense with an exact location account and receipt', () => {
    expect(ResolvedLocalExpenseActionSchema.parse(localExpense)).toEqual(localExpense);
    expect(actionPreconditionIssues(
      'RECORD_LOCAL_EXPENSE',
      localExpense,
      localExpensePreconditions as never,
    )).toEqual([]);
  });

  it('blocks stale local expenses when identity, account, policy, or receipt changes', () => {
    expect(actionPreconditionIssues('RECORD_LOCAL_EXPENSE', localExpense, {
      ...localExpensePreconditions,
      user: {
        ...localExpensePreconditions.user,
        defaultFinanceAccountId: 'account-replaced',
      },
      location: {
        ...localExpensePreconditions.location,
        stockVersion: 4,
      },
      account: {
        ...localExpensePreconditions.account,
        stockLocationId: 'location-other',
      },
      policy: {
        ...localExpensePreconditions.policy,
        maxImmediateAmount: 10_000,
      },
      attachment: {
        ...localExpensePreconditions.attachment,
        userId: 'user-other',
      },
    } as never)).toEqual(expect.arrayContaining([
      { field: 'account', code: 'expense_default_account_changed' },
      { field: 'locationQuery', code: 'location_stale' },
      { field: 'account', code: 'expense_default_account_invalid' },
      { field: 'categoryType', code: 'expense_policy_changed' },
      { field: 'receipt', code: 'expense_receipt_invalid' },
    ]));
  });

  it('accepts a current sold-item return and blocks changed quantities or locations', () => {
    expect(ResolvedReturnToQuarantineActionSchema.parse(returnedGoods)).toEqual(returnedGoods);
    expect(actionPreconditionIssues(
      'RETURN_TO_QUARANTINE',
      returnedGoods,
      returnedGoodsPreconditions as never,
    )).toEqual([]);
    expect(actionPreconditionIssues('RETURN_TO_QUARANTINE', {
      ...returnedGoods,
      quantity: 2.5,
    }, {
      ...returnedGoodsPreconditions,
      fulfillment: { ...returnedGoodsPreconditions.fulfillment, stockVersion: 4 },
      quarantine: { ...returnedGoodsPreconditions.quarantine, stockVersion: 3 },
    } as never)).toEqual(expect.arrayContaining([
      { field: 'orderQuery', code: 'location_stale' },
      { field: 'quantity', code: 'return_exceeds_sold_quantity', detail: '2:2.5' },
    ]));
  });

  it('accepts exact returned-goods disposition and blocks stale or depleted quarantine stock', () => {
    expect(ResolvedDisposeReturnedGoodsActionSchema.parse(returnDisposition)).toEqual(returnDisposition);
    expect(actionPreconditionIssues(
      'DISPOSE_RETURNED_GOODS',
      returnDisposition,
      returnDispositionPreconditions as never,
    )).toEqual([]);
    expect(actionPreconditionIssues('DISPOSE_RETURNED_GOODS', returnDisposition, {
      ...returnDispositionPreconditions,
      returned: {
        document: {
          ...returnDispositionPreconditions.returned.document,
          version: 2,
        },
      },
      quarantine: { ...returnDispositionPreconditions.quarantine, stockVersion: 3 },
      destination: { ...returnDispositionPreconditions.destination, stockVersion: 5 },
      availableQuantity: 0.5,
    } as never)).toEqual(expect.arrayContaining([
      { field: 'returnQuery', code: 'document_stale' },
      { field: 'returnQuery', code: 'location_stale' },
      { field: 'destinationLocationQuery', code: 'location_stale' },
      { field: 'quantity', code: 'return_disposition_exceeds_quarantine', detail: '0.5:1' },
    ]));
  });

  it('accepts an eligible stock reversal and blocks drift or consumed dependencies', () => {
    expect(ResolvedReverseStockDocumentActionSchema.parse(stockReversal)).toEqual(stockReversal);
    expect(actionPreconditionIssues(
      'REVERSE_STOCK_DOCUMENT',
      stockReversal,
      stockReversalPreconditions as never,
    )).toEqual([]);
    expect(actionPreconditionIssues('REVERSE_STOCK_DOCUMENT', stockReversal, {
      ...stockReversalPreconditions,
      document: { ...stockReversalPreconditions.document, version: 3 },
      locations: [{ id: 'location-raw', isActive: true, stockVersion: 6 }],
      outputReversible: false,
      financeReversible: false,
    } as never)).toEqual(expect.arrayContaining([
      { field: 'documentQuery', code: 'document_stale' },
      { field: 'documentQuery', code: 'location_stale' },
      { field: 'documentQuery', code: 'stock_document_output_consumed' },
      { field: 'documentQuery', code: 'stock_finance_not_reversible' },
    ]));
  });
});
