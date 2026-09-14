import 'server-only';
import { z } from 'zod';
import {
  CURRENCIES,
  CUSTOMER_SEGMENTS,
  EXPENSE_CATEGORY_TYPES,
  FULFILLMENT_METHODS,
  INVENTORY_CATEGORIES,
  LOCAL_OPEX_CATEGORY_TYPES,
  PARTY_TYPES,
  PAYMENT_METHODS,
  RETURN_DISPOSITIONS,
} from '@/lib/enums';
import { MEASUREMENT_UNITS } from '@/lib/units';
import { DashboardConfigSchema } from '@/lib/dashboard-builder';

export const ResolvedCustomerActionSchema = z.object({
  nameEn: z.string().optional(),
  nameAr: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  governorate: z.string().optional(),
  address1: z.string().optional(),
  street: z.string().optional(),
  notes: z.string().optional(),
  campaignSource: z.string().optional(),
  segment: z.enum(CUSTOMER_SEGMENTS),
}).strict();

export const ResolvedCustomerEnrichmentSchema = z.object({
  nameEn: z.string().trim().optional(),
  nameAr: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  governorate: z.string().trim().optional(),
  address1: z.string().trim().optional(),
  street: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  campaignSource: z.string().trim().optional(),
  segment: z.enum(CUSTOMER_SEGMENTS).optional(),
}).strict();

export const ResolvedPartyActionSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(PARTY_TYPES),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  address: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  openingPayable: z.number().int().default(0),
  openingReceivable: z.number().int().default(0),
  notes: z.string().trim().optional(),
  equityShare: z.number().min(0).max(100).optional(),
  defaultSettlementAccountId: z.string().trim().optional(),
  netFeesFromRemittance: z.boolean().default(false),
  collectsOrderPayments: z.boolean().default(false),
}).strict();

export const ResolvedLedgerLineActionSchema = z.object({
  token: z.string().trim().min(1).optional(),
  itemType: z.enum(['INVENTORY', 'ASSET', 'EXPENSE', 'SERVICE', 'OTHER']),
  itemName: z.string().trim().min(1),
  categoryType: z.enum(EXPENSE_CATEGORY_TYPES).nullable(),
  assetKey: z.string().trim().nullable(),
  assetCategory: z.string().trim().nullable(),
  inventoryItemId: z.string().trim().nullable(),
  inventoryItemMode: z.enum(['existing', 'new']),
  newItemNameEn: z.string().trim(),
  newItemNameAr: z.string().trim(),
  newItemCategory: z.enum(INVENTORY_CATEGORIES).nullable(),
  unit: z.enum(MEASUREMENT_UNITS),
  quantity: z.number().positive().refine((value) => Number.isInteger(value * 1000)),
  unitCost: z.number().positive(),
  discount: z.number().nonnegative(),
  extra: z.number().nonnegative(),
  branchId: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.itemType === 'INVENTORY') {
    if (value.inventoryItemMode === 'existing' && !value.inventoryItemId) {
      ctx.addIssue({ code: 'custom', path: ['inventoryItemId'], message: 'An existing inventory item is required.' });
    }
    if (value.inventoryItemMode === 'new' && (!value.newItemNameEn || !value.newItemCategory)) {
      ctx.addIssue({ code: 'custom', path: ['newItemNameEn'], message: 'A new inventory item name and category are required.' });
    }
  }
});

export const ResolvedOrderActionSchema = z.object({
  customerExternalId: z.string().nullable(),
  newCustomer: ResolvedCustomerActionSchema.nullable(),
  customerEnrichment: ResolvedCustomerEnrichmentSchema.nullable().default(null),
  placedAt: z.string().datetime(),
  channel: z.string().min(1),
  governorate: z.string().min(1),
  fulfillmentMethod: z.enum(FULFILLMENT_METHODS),
  fulfillmentLocationId: z.string().min(1).optional(),
  fulfillmentLocationName: z.string().min(1).optional(),
  expectedLocationVersion: z.number().int().positive().optional(),
  status: z.string().min(1),
  deliveryFee: z.number().int().nonnegative(),
  deliveryCost: z.number().int().nonnegative(),
  orderDiscount: z.number().int().nonnegative(),
  extraCharges: z.number().int().nonnegative(),
  notes: z.string().nullable(),
  financeMode: z.enum(['AUTO', 'NONE', 'CREDIT', 'PAID', 'PARTIAL', 'PROVIDER']),
  financeAccountId: z.string().nullable(),
  financeProviderId: z.string().nullable(),
  financePaidAmount: z.number().int().nonnegative().nullable(),
  financePaymentMethod: z.string().nullable(),
  financePaymentDate: z.string().datetime().nullable(),
  financeDueDate: z.string().datetime().nullable(),
  lines: z.array(z.object({
    productId: z.string(),
    sku: z.string(),
    quantity: z.number().int().positive(),
    unitGrossPrice: z.number().int().nonnegative(),
    lineDiscount: z.number().int().nonnegative(),
  }).strict()).min(1).max(30),
}).strict().superRefine((value, context) => {
  const locationFields = [
    value.fulfillmentLocationId,
    value.fulfillmentLocationName,
    value.expectedLocationVersion,
  ];
  if (locationFields.some((field) => field !== undefined) && locationFields.some((field) => field === undefined)) {
    context.addIssue({ code: 'custom', path: ['fulfillmentLocationId'], message: 'inventory_v2_location_context_incomplete' });
  }
});

export const ResolvedExpenseActionSchema = z.object({
  date: z.string().datetime(),
  amount: z.number().positive().nullable(),
  currency: z.enum(CURRENCIES),
  rate: z.number().positive().nullable(),
  accountId: z.string(),
  categoryType: z.enum(EXPENSE_CATEGORY_TYPES).nullable(),
  partyId: z.string().nullable(),
  newParty: ResolvedPartyActionSchema.nullable().default(null),
  description: z.string().min(1),
  reference: z.string().nullable(),
  branchId: z.string().nullable(),
  lines: z.array(ResolvedLedgerLineActionSchema).min(1).max(50).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.partyId && value.newParty) {
    ctx.addIssue({ code: 'custom', path: ['newParty'], message: 'Choose an existing party or create a new one.' });
  }
  if (!value.lines?.length && (!value.amount || !value.categoryType)) {
    ctx.addIssue({ code: 'custom', path: ['amount'], message: 'A single expense requires an amount and category.' });
  }
});

export const ResolvedPurchaseActionSchema = z.object({
  purchaseType: z.enum(['INVENTORY', 'ASSET', 'MIXED']),
  date: z.string().datetime(),
  totalAmount: z.number().positive().nullable(),
  currency: z.enum(CURRENCIES),
  rate: z.number().positive().nullable(),
  quantity: z.number().positive().nullable(),
  unit: z.enum(MEASUREMENT_UNITS).nullable(),
  inventoryItemId: z.string().nullable(),
  newItemNameEn: z.string().nullable(),
  newItemNameAr: z.string().nullable(),
  newItemCategory: z.enum(INVENTORY_CATEGORIES).nullable(),
  assetName: z.string().nullable(),
  assetCategory: z.string().nullable(),
  supplierId: z.string().nullable(),
  newSupplier: ResolvedPartyActionSchema.nullable().default(null),
  paidMode: z.enum(['PAID', 'CREDIT', 'PARTIAL']),
  paidAmount: z.number().nonnegative().nullable(),
  accountId: z.string().nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  paymentDate: z.string().datetime().nullable(),
  dueDate: z.string().datetime().nullable(),
  branchId: z.string().nullable(),
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  lines: z.array(ResolvedLedgerLineActionSchema).min(1).max(50).nullable(),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.supplierId) === Boolean(value.newSupplier)) {
    ctx.addIssue({ code: 'custom', path: ['supplierId'], message: 'Exactly one supplier source is required.' });
  }
  if (value.lines?.length) return;
  if (!value.totalAmount || !value.quantity || !value.unit || value.purchaseType === 'MIXED') {
    ctx.addIssue({ code: 'custom', path: ['lines'], message: 'A single purchase requires type, amount, quantity, and unit.' });
  }
  if (value.purchaseType === 'INVENTORY' && !value.inventoryItemId && (!value.newItemNameEn || !value.newItemCategory)) {
    ctx.addIssue({ code: 'custom', path: ['inventoryItemId'], message: 'An inventory item is required.' });
  }
  if (value.purchaseType === 'ASSET' && (!value.assetName || !value.assetCategory)) {
    ctx.addIssue({ code: 'custom', path: ['assetName'], message: 'An asset name and category are required.' });
  }
});

export const ResolvedTransferActionSchema = z.object({
  date: z.string().datetime(),
  amount: z.number().positive(),
  currency: z.enum(CURRENCIES),
  rate: z.number().positive().nullable(),
  fromAccountId: z.string().min(1),
  fromAccountName: z.string().min(1),
  toAccountId: z.string().min(1),
  toAccountName: z.string().min(1),
  description: z.string().trim().min(1),
  reference: z.string().trim().nullable(),
}).strict().refine((value) => value.fromAccountId !== value.toAccountId, {
  path: ['toAccountId'],
  message: 'Transfer accounts must be different.',
});

export const ResolvedOrderStatusActionSchema = z.object({
  orderId: z.string(),
  orderNumber: z.string(),
  status: z.string(),
  completionMode: z.enum(['AUTO', 'DIRECT', 'PROVIDER']),
  accountId: z.string().nullable(),
  providerKey: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  date: z.string().datetime().nullable(),
}).strict();

export const ResolvedCustomerUpdateActionSchema = z.object({
  customerId: z.string().min(1),
  externalId: z.string().nullable(),
  nameEn: z.string().trim().nullable().optional(),
  nameAr: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().email().nullable().optional().or(z.literal('')),
  governorate: z.string().trim().nullable().optional(),
  address1: z.string().trim().nullable().optional(),
  street: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  segment: z.enum(CUSTOMER_SEGMENTS).optional(),
  campaignSource: z.string().trim().nullable().optional(),
  reason: z.string().trim().min(3),
}).strict();

export const ResolvedPartyUpdateActionSchema = ResolvedPartyActionSchema.partial().extend({
  partyId: z.string().min(1),
  partyName: z.string().min(1),
  reason: z.string().trim().min(3),
}).strict();

export const ResolvedInventoryAdjustmentActionSchema = z.object({
  inventoryItemId: z.string().min(1),
  inventoryItemName: z.string().min(1),
  targetQuantity: z.number().nonnegative().refine((value) => Number.isInteger(value * 1000)),
  occurredAt: z.string().datetime(),
  reason: z.string().trim().min(3),
  locationId: z.string().min(1).optional(),
  locationName: z.string().min(1).optional(),
  expectedLocationVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
}).strict().superRefine((value, context) => {
  const locationFields = [
    value.locationId,
    value.locationName,
    value.expectedLocationVersion,
    value.idempotencyKey,
  ];
  if (locationFields.some((field) => field !== undefined) && locationFields.some((field) => field === undefined)) {
    context.addIssue({ code: 'custom', path: ['locationId'], message: 'inventory_v2_location_context_incomplete' });
  }
});

export const ResolvedStockReceiptActionSchema = z.object({
  inventoryItemId: z.string().min(1),
  inventoryItemName: z.string().min(1),
  inventoryUnit: z.string().min(1),
  locationId: z.string().min(1),
  locationName: z.string().min(1),
  expectedLocationVersion: z.number().int().positive(),
  quantity: z.number().positive().refine((value) => Number.isInteger(value * 1000)),
  unitCost: z.number().nonnegative().refine((value) => Number.isInteger(value * 1000)),
  occurredAt: z.string().datetime(),
  bestBefore: z.string().datetime().nullable(),
  supplierLot: z.string().trim().nullable(),
  partyId: z.string().min(1).nullable(),
  supplierName: z.string().min(1),
  newSupplier: ResolvedPartyActionSchema.nullable(),
  paymentMode: z.enum(['CREDIT', 'PAID']),
  accountId: z.string().min(1).nullable(),
  accountName: z.string().min(1).nullable(),
  dueDate: z.string().datetime().nullable(),
  reference: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
  idempotencyKey: z.string().min(8).max(200),
}).strict().superRefine((value, context) => {
  if (Boolean(value.partyId) === Boolean(value.newSupplier)) {
    context.addIssue({ code: 'custom', path: ['partyId'], message: 'supplier_source_required' });
  }
  if (value.newSupplier && value.newSupplier.type !== 'SUPPLIER') {
    context.addIssue({ code: 'custom', path: ['newSupplier', 'type'], message: 'supplier_type_invalid' });
  }
  if (value.paymentMode === 'PAID' && (!value.accountId || !value.accountName)) {
    context.addIssue({ code: 'custom', path: ['accountId'], message: 'payment_account_required' });
  }
  if (value.paymentMode === 'CREDIT' && !value.dueDate) {
    context.addIssue({ code: 'custom', path: ['dueDate'], message: 'due_date_required' });
  }
});

export const ResolvedPackingActionSchema = z.object({
  locationId: z.string().min(1),
  locationName: z.string().min(1),
  expectedLocationVersion: z.number().int().positive(),
  productId: z.string().min(1),
  productName: z.string().min(1),
  outputInventoryItemId: z.string().min(1),
  outputInventoryItemName: z.string().min(1),
  outputUnit: z.string().min(1),
  recipeVersionId: z.string().min(1),
  recipeVersion: z.number().int().positive(),
  outputQuantity: z.number().positive().refine((value) => Number.isInteger(value * 1000)),
  rejectedQuantity: z.number().nonnegative().refine((value) => Number.isInteger(value * 1000)),
  packedAt: z.string().datetime(),
  bestBefore: z.string().datetime().nullable(),
  notes: z.string().trim().nullable(),
  idempotencyKey: z.string().min(8).max(200),
}).strict();

const ResolvedStockTransferLineSchema = z.object({
  inventoryItemId: z.string().min(1),
  inventoryItemName: z.string().min(1),
  unit: z.string().min(1),
  quantity: z.number().positive().refine((value) => Number.isInteger(value * 1000)),
}).strict();

export const ResolvedDispatchStockTransferActionSchema = z.object({
  sourceLocationId: z.string().min(1),
  sourceLocationName: z.string().min(1),
  destinationLocationId: z.string().min(1),
  destinationLocationName: z.string().min(1),
  transitLocationId: z.string().min(1),
  transitLocationName: z.string().min(1),
  expectedSourceVersion: z.number().int().positive(),
  expectedTransitVersion: z.number().int().positive(),
  lines: z.array(ResolvedStockTransferLineSchema).min(1).max(100),
  occurredAt: z.string().datetime(),
  expectedAt: z.string().datetime().nullable(),
  notes: z.string().trim().nullable(),
  idempotencyKey: z.string().min(8).max(200),
}).strict().superRefine((value, context) => {
  if (value.sourceLocationId === value.destinationLocationId) {
    context.addIssue({ code: 'custom', path: ['destinationLocationId'], message: 'transfer_same_location' });
  }
  const itemIds = value.lines.map((line) => line.inventoryItemId);
  if (new Set(itemIds).size !== itemIds.length) {
    context.addIssue({ code: 'custom', path: ['lines'], message: 'transfer_duplicate_item' });
  }
});

const ResolvedStockTransferDiscrepancySchema = z.object({
  inventoryItemId: z.string().min(1),
  inventoryItemName: z.string().min(1),
  unit: z.string().min(1),
  type: z.enum(['SHORTAGE', 'DAMAGE', 'EXCESS']),
  quantity: z.number().positive().refine((value) => Number.isInteger(value * 1000)),
  notes: z.string().trim().min(3),
}).strict();

export const ResolvedReceiveStockTransferActionSchema = z.object({
  stockDocumentId: z.string().min(1),
  transferNumber: z.string().min(1),
  expectedDocumentVersion: z.number().int().positive(),
  destinationLocationId: z.string().min(1),
  destinationLocationName: z.string().min(1),
  transitLocationId: z.string().min(1),
  transitLocationName: z.string().min(1),
  expectedDestinationVersion: z.number().int().positive(),
  expectedTransitVersion: z.number().int().positive(),
  lines: z.array(ResolvedStockTransferLineSchema).max(100),
  discrepancies: z.array(ResolvedStockTransferDiscrepancySchema).max(100),
  occurredAt: z.string().datetime(),
  notes: z.string().trim().nullable(),
  idempotencyKey: z.string().min(8).max(200),
}).strict().superRefine((value, context) => {
  if (!value.lines.length && !value.discrepancies.length) {
    context.addIssue({ code: 'custom', path: ['lines'], message: 'transfer_receipt_empty' });
  }
  const lineIds = value.lines.map((line) => line.inventoryItemId);
  if (new Set(lineIds).size !== lineIds.length) {
    context.addIssue({ code: 'custom', path: ['lines'], message: 'transfer_duplicate_item' });
  }
  const discrepancyIds = value.discrepancies.map((row) => row.inventoryItemId);
  if (new Set(discrepancyIds).size !== discrepancyIds.length) {
    context.addIssue({ code: 'custom', path: ['discrepancies'], message: 'transfer_discrepancy_duplicate_item' });
  }
});

export const ResolvedLocalExpenseActionSchema = z.object({
  userId: z.string().min(1),
  locationId: z.string().min(1),
  locationName: z.string().min(1),
  expectedLocationVersion: z.number().int().positive(),
  amount: z.number().int().positive(),
  categoryType: z.enum(LOCAL_OPEX_CATEGORY_TYPES),
  description: z.string().trim().min(3),
  occurredAt: z.string().datetime(),
  financeAccountId: z.string().min(1),
  financeAccountName: z.string().min(1),
  receiptAttachmentId: z.string().min(1).nullable(),
  receiptFileName: z.string().min(1).nullable(),
  noReceiptReason: z.string().trim().min(3).nullable(),
  willRequireReview: z.boolean(),
  idempotencyKey: z.string().min(8).max(200),
}).strict().superRefine((value, context) => {
  if (Boolean(value.receiptAttachmentId) === Boolean(value.noReceiptReason)) {
    context.addIssue({ code: 'custom', path: ['receiptAttachmentId'], message: 'expense_evidence_required' });
  }
  if (Boolean(value.receiptAttachmentId) !== Boolean(value.receiptFileName)) {
    context.addIssue({ code: 'custom', path: ['receiptFileName'], message: 'expense_attachment_incomplete' });
  }
});

export const ResolvedReturnToQuarantineActionSchema = z.object({
  orderId: z.string().min(1),
  orderNumber: z.string().min(1),
  orderLineId: z.string().min(1),
  productName: z.string().min(1),
  sku: z.string().min(1),
  inventoryItemId: z.string().min(1),
  inventoryItemName: z.string().min(1),
  unit: z.string().min(1),
  fulfillmentLocationId: z.string().min(1),
  fulfillmentLocationName: z.string().min(1),
  expectedFulfillmentVersion: z.number().int().positive(),
  quarantineLocationId: z.string().min(1),
  quarantineLocationName: z.string().min(1),
  expectedQuarantineVersion: z.number().int().positive(),
  quantity: z.number().positive().refine((value) => Number.isInteger(value * 1000)),
  occurredAt: z.string().datetime(),
  reason: z.string().trim().min(3),
  idempotencyKey: z.string().min(8).max(200),
}).strict().superRefine((value, context) => {
  if (value.fulfillmentLocationId === value.quarantineLocationId) {
    context.addIssue({ code: 'custom', path: ['quarantineLocationId'], message: 'return_quarantine_same_location' });
  }
});

export const ResolvedDisposeReturnedGoodsActionSchema = z.object({
  returnDocumentId: z.string().min(1),
  returnDocumentNumber: z.string().min(1),
  expectedReturnDocumentVersion: z.number().int().positive(),
  inventoryItemId: z.string().min(1),
  inventoryItemName: z.string().min(1),
  unit: z.string().min(1),
  quarantineLocationId: z.string().min(1),
  quarantineLocationName: z.string().min(1),
  expectedQuarantineVersion: z.number().int().positive(),
  quantity: z.number().positive().refine((value) => Number.isInteger(value * 1000)),
  disposition: z.enum(RETURN_DISPOSITIONS),
  destinationLocationId: z.string().min(1).nullable(),
  destinationLocationName: z.string().min(1).nullable(),
  expectedDestinationVersion: z.number().int().positive().nullable(),
  supplierPartyId: z.string().min(1).nullable(),
  supplierName: z.string().min(1).nullable(),
  occurredAt: z.string().datetime(),
  reason: z.string().trim().min(3),
  idempotencyKey: z.string().min(8).max(200),
}).strict().superRefine((value, context) => {
  const needsDestination = value.disposition === 'RESTOCK' || value.disposition === 'REPACK';
  if (needsDestination !== Boolean(value.destinationLocationId)) {
    context.addIssue({ code: 'custom', path: ['destinationLocationId'], message: 'return_destination_invalid' });
  }
  if (Boolean(value.destinationLocationId) !== Boolean(value.destinationLocationName)) {
    context.addIssue({ code: 'custom', path: ['destinationLocationName'], message: 'return_destination_incomplete' });
  }
  if (Boolean(value.destinationLocationId) !== Boolean(value.expectedDestinationVersion)) {
    context.addIssue({ code: 'custom', path: ['expectedDestinationVersion'], message: 'return_destination_incomplete' });
  }
  const needsSupplier = value.disposition === 'RETURN_TO_SUPPLIER';
  if (needsSupplier !== Boolean(value.supplierPartyId)) {
    context.addIssue({ code: 'custom', path: ['supplierPartyId'], message: 'return_supplier_invalid' });
  }
  if (Boolean(value.supplierPartyId) !== Boolean(value.supplierName)) {
    context.addIssue({ code: 'custom', path: ['supplierName'], message: 'return_supplier_incomplete' });
  }
  if (value.destinationLocationId === value.quarantineLocationId) {
    context.addIssue({ code: 'custom', path: ['destinationLocationId'], message: 'return_destination_same_location' });
  }
});

export const ResolvedReverseStockDocumentActionSchema = z.object({
  stockDocumentId: z.string().min(1),
  documentNumber: z.string().min(1),
  documentType: z.string().min(1),
  expectedDocumentVersion: z.number().int().positive(),
  expectedLocationVersions: z.array(z.object({
    locationId: z.string().min(1),
    locationName: z.string().min(1),
    stockVersion: z.number().int().positive(),
  }).strict()).min(1).max(10),
  occurredAt: z.string().datetime(),
  reason: z.string().trim().min(3),
  idempotencyKey: z.string().min(8).max(200),
}).strict().superRefine((value, context) => {
  const locationIds = value.expectedLocationVersions.map((row) => row.locationId);
  if (new Set(locationIds).size !== locationIds.length) {
    context.addIssue({ code: 'custom', path: ['expectedLocationVersions'], message: 'location_version_duplicate' });
  }
});

export const ResolvedRoastBatchActionSchema = z.object({
  batchNumber: z.string().trim().min(1),
  origin: z.string().trim().min(1),
  roastDate: z.string().datetime().nullable(),
  roastLevel: z.string().trim().nullable(),
  greenInputGrams: z.number().int().positive(),
  roastedOutputGrams: z.number().int().positive().nullable(),
  abnormalLossGrams: z.number().int().nonnegative().optional(),
  qcScore: z.number().nullable(),
  qcNotes: z.string().trim().nullable(),
  greenInventoryItemId: z.string().nullable(),
  roastedInventoryItemId: z.string().nullable(),
  branchId: z.string().nullable(),
  locationId: z.string().min(1).optional(),
  locationName: z.string().min(1).optional(),
  expectedLocationVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
}).strict().superRefine((value, context) => {
  const locationFields = [
    value.locationId,
    value.locationName,
    value.expectedLocationVersion,
    value.idempotencyKey,
  ];
  if (locationFields.some((field) => field !== undefined) && locationFields.some((field) => field === undefined)) {
    context.addIssue({ code: 'custom', path: ['locationId'], message: 'inventory_v2_location_context_incomplete' });
  }
  if (
    value.abnormalLossGrams !== undefined &&
    value.roastedOutputGrams !== null &&
    value.abnormalLossGrams > value.greenInputGrams - value.roastedOutputGrams
  ) {
    context.addIssue({ code: 'custom', path: ['abnormalLossGrams'], message: 'abnormal_loss_exceeds_shrinkage' });
  }
});

export const ResolvedPaymentActionSchema = z.object({
  targetType: z.enum(['ORDER', 'FINANCE_ENTRY']),
  targetId: z.string().min(1),
  targetNumber: z.string().min(1),
  amount: z.number().positive(),
  accountId: z.string().min(1),
  accountName: z.string().min(1),
  paymentMethod: z.string().trim().nullable(),
  date: z.string().datetime(),
}).strict();

export const ResolvedRefundActionSchema = z.object({
  orderId: z.string().min(1),
  orderNumber: z.string().min(1),
  amount: z.number().positive(),
  accountId: z.string().min(1),
  accountName: z.string().min(1),
  paymentMethod: z.string().trim().nullable(),
  date: z.string().datetime(),
  reason: z.string().trim().min(3),
}).strict();

export const ResolvedReversalActionSchema = z.object({
  financeEntryId: z.string().min(1),
  recordNumber: z.string().min(1),
  reason: z.string().trim().min(3),
}).strict();

export const ResolvedSpendReclassificationActionSchema = z.object({
  entryId: z.string().min(1),
  recordNumber: z.string().min(1),
  lineId: z.string().min(1),
  lineName: z.string().min(1),
  spendTreatment: z.enum(['CAPEX', 'INVENTORY', 'OPEX', 'REVIEW']),
  classificationNote: z.string().trim().min(3),
  fixedAssetId: z.string().nullable(),
  inventoryItemId: z.string().nullable(),
}).strict();

export const ResolvedDashboardDraftActionSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().nullable(),
  config: DashboardConfigSchema,
}).strict();

export const ACTION_DATA_SCHEMAS: Partial<Record<import('@prisma/client').AiPendingActionType, z.ZodType>> = {
  CREATE_CUSTOMER: ResolvedCustomerActionSchema,
  CREATE_ORDER: ResolvedOrderActionSchema,
  CREATE_EXPENSE: ResolvedExpenseActionSchema,
  CREATE_PURCHASE: ResolvedPurchaseActionSchema,
  CREATE_TRANSFER: ResolvedTransferActionSchema,
  UPDATE_ORDER_STATUS: ResolvedOrderStatusActionSchema,
  UPDATE_CUSTOMER: ResolvedCustomerUpdateActionSchema,
  UPDATE_PARTY: ResolvedPartyUpdateActionSchema,
  ADJUST_INVENTORY: ResolvedInventoryAdjustmentActionSchema,
  RECEIVE_STOCK: ResolvedStockReceiptActionSchema,
  PACK_FINISHED_GOODS: ResolvedPackingActionSchema,
  DISPATCH_STOCK_TRANSFER: ResolvedDispatchStockTransferActionSchema,
  RECEIVE_STOCK_TRANSFER: ResolvedReceiveStockTransferActionSchema,
  RECORD_LOCAL_EXPENSE: ResolvedLocalExpenseActionSchema,
  RETURN_TO_QUARANTINE: ResolvedReturnToQuarantineActionSchema,
  DISPOSE_RETURNED_GOODS: ResolvedDisposeReturnedGoodsActionSchema,
  REVERSE_STOCK_DOCUMENT: ResolvedReverseStockDocumentActionSchema,
  CREATE_ROAST_BATCH: ResolvedRoastBatchActionSchema,
  RECORD_PAYMENT: ResolvedPaymentActionSchema,
  RECORD_REFUND: ResolvedRefundActionSchema,
  REVERSE_RECORD: ResolvedReversalActionSchema,
  RECLASSIFY_SPEND: ResolvedSpendReclassificationActionSchema,
  CREATE_DASHBOARD_DRAFT: ResolvedDashboardDraftActionSchema,
} as const;
