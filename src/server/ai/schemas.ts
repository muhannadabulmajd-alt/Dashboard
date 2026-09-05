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

export const AssistantRangeSchema = z.object({
  preset: z.enum(['today', 'yesterday', '7d', 'this_month', 'last_month', 'all', 'custom']),
  from: z.string().nullable(),
  to: z.string().nullable(),
}).strict();

export const SearchSchema = z.object({
  query: z.string().trim(),
  limit: z.number().int().min(1).max(25),
}).strict();

export const SalesSummarySchema = z.object({
  range: AssistantRangeSchema,
  dimension: z.enum(['NONE', 'CHANNEL', 'CITY', 'PRODUCT']).nullable(),
}).strict();

export const ProductBuyersSchema = z.object({
  productQuery: z.string().trim().min(1),
  range: AssistantRangeSchema,
  limit: z.number().int().min(1).max(50),
}).strict();

export const InventorySummarySchema = z.object({
  query: z.string().trim().nullable(),
  lowStockOnly: z.boolean(),
  limit: z.number().int().min(1).max(25),
}).strict();

export const ExpenseSummarySchema = z.object({
  range: AssistantRangeSchema,
  bucket: z.enum(['all', 'capex', 'inventory', 'opex', 'review', 'direct', 'cogs']),
  category: z.string().trim().nullable(),
}).strict();

export const PrepareCustomerSchema = z.object({
  nameEn: z.string().trim().nullable(),
  nameAr: z.string().trim().nullable(),
  phone: z.string().trim().nullable(),
  email: z.string().trim().nullable(),
  governorate: z.string().trim().nullable(),
  address1: z.string().trim().nullable(),
  street: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
  campaignSource: z.string().trim().nullable(),
  segment: z.enum(CUSTOMER_SEGMENTS).nullable(),
}).strict();

export const PreparePartyDetailsSchema = z.object({
  name: z.string().trim().nullable(),
  type: z.enum(PARTY_TYPES).nullable(),
  phone: z.string().trim().nullable(),
  email: z.string().trim().nullable(),
  address: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
}).strict();

export const PrepareLedgerLineSchema = z.object({
  itemType: z.enum(['INVENTORY', 'ASSET', 'EXPENSE', 'SERVICE', 'OTHER']).nullable(),
  itemName: z.string().trim().nullable(),
  categoryType: z.enum(EXPENSE_CATEGORY_TYPES).nullable(),
  assetKey: z.string().trim().nullable(),
  assetCategory: z.string().trim().nullable(),
  inventoryItemQuery: z.string().trim().nullable(),
  newItemNameEn: z.string().trim().nullable(),
  newItemNameAr: z.string().trim().nullable(),
  newItemCategory: z.enum(INVENTORY_CATEGORIES).nullable(),
  unit: z.enum(MEASUREMENT_UNITS).nullable(),
  quantity: z.number().positive().nullable(),
  unitCost: z.number().positive().nullable(),
  discount: z.number().nonnegative().nullable(),
  extra: z.number().nonnegative().nullable(),
  branchQuery: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
}).strict();

export const PrepareOrderSchema = z.object({
  customerQuery: z.string().trim().nullable(),
  newCustomer: PrepareCustomerSchema.nullable(),
  placedAt: z.string().nullable(),
  channel: z.string().trim().nullable(),
  governorate: z.string().trim().nullable(),
  fulfillmentMethod: z.enum(FULFILLMENT_METHODS).nullable(),
  status: z.string().trim().nullable(),
  deliveryFee: z.number().int().nonnegative(),
  deliveryCost: z.number().int().nonnegative(),
  orderDiscount: z.number().int().nonnegative(),
  extraCharges: z.number().int().nonnegative(),
  notes: z.string().trim().nullable(),
  financeMode: z.enum(['AUTO', 'NONE', 'CREDIT', 'PAID', 'PARTIAL', 'PROVIDER']).nullable(),
  financeAccountQuery: z.string().trim().nullable(),
  financeProviderQuery: z.string().trim().nullable(),
  financePaidAmount: z.number().int().nonnegative().nullable(),
  financePaymentMethod: z.string().trim().nullable(),
  financePaymentDate: z.string().nullable(),
  financeDueDate: z.string().nullable(),
  lines: z.array(z.object({
    productQuery: z.string().trim().min(1),
    quantity: z.number().int().positive(),
    unitGrossPrice: z.number().int().nonnegative().nullable(),
    lineDiscount: z.number().int().nonnegative(),
  }).strict()).min(1).max(30),
}).strict();

export const PrepareExpenseSchema = z.object({
  date: z.string().nullable(),
  amount: z.number().positive().nullable(),
  currency: z.enum(CURRENCIES).nullable(),
  rate: z.number().positive().nullable(),
  accountQuery: z.string().trim().nullable(),
  categoryType: z.enum(EXPENSE_CATEGORY_TYPES).nullable(),
  partyQuery: z.string().trim().nullable(),
  newParty: PreparePartyDetailsSchema.nullable(),
  description: z.string().trim().nullable(),
  reference: z.string().trim().nullable(),
  branchQuery: z.string().trim().nullable(),
  lines: z.array(PrepareLedgerLineSchema).min(1).max(50).nullable(),
}).strict();

export const PreparePurchaseSchema = z.object({
  purchaseType: z.enum(['INVENTORY', 'ASSET', 'MIXED']).nullable(),
  date: z.string().nullable(),
  totalAmount: z.number().positive().nullable(),
  currency: z.enum(CURRENCIES).nullable(),
  rate: z.number().positive().nullable(),
  quantity: z.number().positive().nullable(),
  unit: z.enum(MEASUREMENT_UNITS).nullable(),
  inventoryItemQuery: z.string().trim().nullable(),
  newItemNameEn: z.string().trim().nullable(),
  newItemNameAr: z.string().trim().nullable(),
  newItemCategory: z.enum(INVENTORY_CATEGORIES).nullable(),
  assetName: z.string().trim().nullable(),
  assetCategory: z.string().trim().nullable(),
  supplierQuery: z.string().trim().nullable(),
  newSupplier: PreparePartyDetailsSchema.nullable(),
  paidMode: z.enum(['PAID', 'CREDIT', 'PARTIAL']).nullable(),
  paidAmount: z.number().nonnegative().nullable(),
  accountQuery: z.string().trim().nullable(),
  paymentMethod: z.string().trim().nullable(),
  paymentDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  branchQuery: z.string().trim().nullable(),
  reference: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
  lines: z.array(PrepareLedgerLineSchema).min(1).max(50).nullable(),
}).strict();

export const PrepareOrderStatusSchema = z.object({
  orderQuery: z.string().trim().nullable(),
  status: z.string().trim().nullable(),
  completionMode: z.enum(['AUTO', 'DIRECT', 'PROVIDER']).nullable(),
  accountQuery: z.string().trim().nullable(),
  providerKey: z.string().trim().nullable(),
  paymentMethod: z.string().trim().nullable(),
  date: z.string().nullable(),
}).strict();

export const PrepareCustomerUpdateSchema = z.object({
  customerQuery: z.string().trim().nullable(),
  nameEn: z.string().trim().nullable(),
  nameAr: z.string().trim().nullable(),
  phone: z.string().trim().nullable(),
  email: z.string().trim().nullable(),
  governorate: z.string().trim().nullable(),
  address1: z.string().trim().nullable(),
  street: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
  campaignSource: z.string().trim().nullable(),
  segment: z.enum(CUSTOMER_SEGMENTS).nullable(),
  reason: z.string().trim().nullable(),
}).strict();

export const PreparePartyUpdateSchema = z.object({
  partyQuery: z.string().trim().nullable(),
  name: z.string().trim().nullable(),
  type: z.enum(PARTY_TYPES).nullable(),
  phone: z.string().trim().nullable(),
  email: z.string().trim().nullable(),
  address: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
  netFeesFromRemittance: z.boolean().nullable(),
  collectsOrderPayments: z.boolean().nullable(),
  reason: z.string().trim().nullable(),
}).strict();

export const PrepareInventoryAdjustmentSchema = z.object({
  inventoryItemQuery: z.string().trim().nullable(),
  targetQuantity: z.number().nonnegative().nullable(),
  occurredAt: z.string().nullable(),
  reason: z.string().trim().nullable(),
}).strict();

export const PrepareRoastBatchSchema = z.object({
  batchNumber: z.string().trim().nullable(),
  origin: z.string().trim().nullable(),
  roastDate: z.string().nullable(),
  roastLevel: z.string().trim().nullable(),
  greenInputGrams: z.number().positive().nullable(),
  roastedOutputGrams: z.number().positive().nullable(),
  qcScore: z.number().nullable(),
  qcNotes: z.string().trim().nullable(),
  greenInventoryItemQuery: z.string().trim().nullable(),
  roastedInventoryItemQuery: z.string().trim().nullable(),
  branchQuery: z.string().trim().nullable(),
}).strict();

export const PreparePaymentSchema = z.object({
  targetType: z.enum(['ORDER', 'FINANCE_ENTRY']).nullable(),
  targetQuery: z.string().trim().nullable(),
  amount: z.number().positive().nullable(),
  accountQuery: z.string().trim().nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  date: z.string().nullable(),
}).strict();

export const PrepareRefundSchema = z.object({
  orderQuery: z.string().trim().nullable(),
  amount: z.number().positive().nullable(),
  accountQuery: z.string().trim().nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  date: z.string().nullable(),
  reason: z.string().trim().nullable(),
}).strict();

export const PrepareReversalSchema = z.object({
  recordQuery: z.string().trim().nullable(),
  reason: z.string().trim().nullable(),
}).strict();

export const PrepareSpendReclassificationSchema = z.object({
  recordQuery: z.string().trim().nullable(),
  lineQuery: z.string().trim().nullable(),
  spendTreatment: z.enum(['CAPEX', 'INVENTORY', 'OPEX', 'REVIEW']).nullable(),
  classificationNote: z.string().trim().nullable(),
  fixedAssetQuery: z.string().trim().nullable(),
  inventoryItemQuery: z.string().trim().nullable(),
}).strict();

export const PrepareDashboardDraftSchema = z.object({
  name: z.string().trim().nullable(),
  description: z.string().trim().nullable(),
  template: z.enum([
    'owner-overview',
    'sales-dashboard',
    'inventory-dashboard',
    'delivery-dashboard',
    'financial-dashboard',
    'customer-dashboard',
  ]).nullable(),
}).strict();
