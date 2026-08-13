import 'server-only';
import { z } from 'zod';
import {
  CURRENCIES,
  CUSTOMER_SEGMENTS,
  EXPENSE_CATEGORY_TYPES,
  FULFILLMENT_METHODS,
  INVENTORY_CATEGORIES,
} from '@/lib/enums';
import { MEASUREMENT_UNITS } from '@/lib/units';

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
  amount: z.number().positive(),
  currency: z.enum(CURRENCIES),
  rate: z.number().positive().nullable(),
  accountId: z.string(),
  categoryType: z.enum(EXPENSE_CATEGORY_TYPES),
  partyId: z.string().nullable(),
  description: z.string().min(1),
  reference: z.string().nullable(),
  branchId: z.string().nullable(),
}).strict();

export const ResolvedPurchaseActionSchema = z.object({
  purchaseType: z.enum(['INVENTORY', 'ASSET']),
  date: z.string().datetime(),
  totalAmount: z.number().positive(),
  currency: z.enum(CURRENCIES),
  rate: z.number().positive().nullable(),
  quantity: z.number().positive(),
  unit: z.enum(MEASUREMENT_UNITS),
  inventoryItemId: z.string().nullable(),
  newItemNameEn: z.string().nullable(),
  newItemNameAr: z.string().nullable(),
  newItemCategory: z.enum(INVENTORY_CATEGORIES).nullable(),
  assetName: z.string().nullable(),
  assetCategory: z.string().nullable(),
  supplierId: z.string(),
  paidMode: z.enum(['PAID', 'CREDIT', 'PARTIAL']),
  paidAmount: z.number().nonnegative().nullable(),
  accountId: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  paymentDate: z.string().datetime().nullable(),
  dueDate: z.string().datetime().nullable(),
  branchId: z.string().nullable(),
  reference: z.string().nullable(),
  notes: z.string().nullable(),
}).strict();

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

export const ACTION_DATA_SCHEMAS = {
  CREATE_CUSTOMER: ResolvedCustomerActionSchema,
  CREATE_ORDER: ResolvedOrderActionSchema,
  CREATE_EXPENSE: ResolvedExpenseActionSchema,
  CREATE_PURCHASE: ResolvedPurchaseActionSchema,
  UPDATE_ORDER_STATUS: ResolvedOrderStatusActionSchema,
} as const;
