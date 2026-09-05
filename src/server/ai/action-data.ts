import 'server-only';
import { z } from 'zod';
import {
  CURRENCIES,
  CUSTOMER_SEGMENTS,
  EXPENSE_CATEGORY_TYPES,
  FULFILLMENT_METHODS,
  INVENTORY_CATEGORIES,
  PARTY_TYPES,
  PAYMENT_METHODS,
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
  placedAt: z.string().datetime(),
  channel: z.string().min(1),
  governorate: z.string().min(1),
  fulfillmentMethod: z.enum(FULFILLMENT_METHODS),
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
}).strict();

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
}).strict();

export const ResolvedRoastBatchActionSchema = z.object({
  batchNumber: z.string().trim().min(1),
  origin: z.string().trim().min(1),
  roastDate: z.string().datetime().nullable(),
  roastLevel: z.string().trim().nullable(),
  greenInputGrams: z.number().int().positive(),
  roastedOutputGrams: z.number().int().positive().nullable(),
  qcScore: z.number().nullable(),
  qcNotes: z.string().trim().nullable(),
  greenInventoryItemId: z.string().nullable(),
  roastedInventoryItemId: z.string().nullable(),
  branchId: z.string().nullable(),
}).strict();

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
  UPDATE_ORDER_STATUS: ResolvedOrderStatusActionSchema,
  UPDATE_CUSTOMER: ResolvedCustomerUpdateActionSchema,
  UPDATE_PARTY: ResolvedPartyUpdateActionSchema,
  ADJUST_INVENTORY: ResolvedInventoryAdjustmentActionSchema,
  CREATE_ROAST_BATCH: ResolvedRoastBatchActionSchema,
  RECORD_PAYMENT: ResolvedPaymentActionSchema,
  RECORD_REFUND: ResolvedRefundActionSchema,
  REVERSE_RECORD: ResolvedReversalActionSchema,
  RECLASSIFY_SPEND: ResolvedSpendReclassificationActionSchema,
  CREATE_DASHBOARD_DRAFT: ResolvedDashboardDraftActionSchema,
} as const;
