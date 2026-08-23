import 'server-only';
import type { OpenAI } from 'openai';
import {
  CURRENCIES,
  CUSTOMER_SEGMENTS,
  EXPENSE_CATEGORY_TYPES,
  FULFILLMENT_METHODS,
  INVENTORY_CATEGORIES,
} from '@/lib/enums';
import { MEASUREMENT_UNITS } from '@/lib/units';

type FunctionTool = OpenAI.Responses.FunctionTool;
type Schema = Record<string, unknown>;

const string: Schema = { type: 'string' };
const nullableString: Schema = { type: ['string', 'null'] };
const nullableNumber: Schema = { type: ['number', 'null'] };
const nonnegativeInteger: Schema = { type: 'integer', minimum: 0 };

function object(properties: Record<string, Schema>): Schema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function enumSchema(values: readonly string[], nullable = false): Schema {
  return nullable
    ? { anyOf: [{ type: 'string', enum: [...values] }, { type: 'null' }] }
    : { type: 'string', enum: [...values] };
}

const range = object({
  preset: enumSchema(['today', 'yesterday', '7d', 'this_month', 'last_month', 'all', 'custom']),
  from: nullableString,
  to: nullableString,
});

const customer = object({
  nameEn: nullableString,
  nameAr: nullableString,
  phone: nullableString,
  email: nullableString,
  governorate: nullableString,
  address1: nullableString,
  street: nullableString,
  notes: nullableString,
  campaignSource: nullableString,
  segment: enumSchema(CUSTOMER_SEGMENTS, true),
});

function tool(name: string, description: string, parameters: Schema): FunctionTool {
  return { type: 'function', name, description, parameters, strict: true };
}

export const AI_ASSISTANT_TOOLS: FunctionTool[] = [
  tool(
    'sales_summary',
    'Read canonical sales and profit totals for a Baghdad-time period, optionally grouped by channel, city, or product.',
    object({
      range,
      dimension: enumSchema(['NONE', 'CHANNEL', 'CITY', 'PRODUCT'], true),
    }),
  ),
  tool(
    'search_orders',
    'Find Atlas orders by order number, customer ID, customer name, or customer phone.',
    object({ query: string, limit: { type: 'integer', minimum: 1, maximum: 25 } }),
  ),
  tool(
    'order_details',
    'Read one order with its canonical invoice and payment status. Use an exact order number or a prior search result.',
    object({ query: string }),
  ),
  tool(
    'inventory_summary',
    'Read current inventory quantities, FIFO value, and low-stock state; optionally search by item name.',
    object({
      query: nullableString,
      lowStockOnly: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 25 },
    }),
  ),
  tool(
    'expense_summary',
    'Read canonical total spending and spending rows for Capex, inventory purchases, Opex, review, direct costs, or COGS.',
    object({
      range,
      bucket: enumSchema(['all', 'capex', 'inventory', 'opex', 'review', 'direct', 'cogs']),
      category: nullableString,
    }),
  ),
  tool(
    'search_customers',
    'Find customers by exact or partial name, Iraqi phone number, or permanent customer ID.',
    object({ query: string, limit: { type: 'integer', minimum: 1, maximum: 25 } }),
  ),
  tool(
    'prepare_create_customer',
    'Prepare a new customer for explicit user confirmation. This never writes immediately.',
    customer,
  ),
  tool(
    'prepare_create_order',
    'Prepare an order for explicit confirmation. Preserve the user\'s complete product wording, including name, size, grind, and flavor. If customerQuery does not match an existing customer, Atlas prepares a new customer in the same confirmed transaction; use newCustomer for any additional supplied customer details. Atlas supplies safe operational defaults for omitted date, channel, governorate, fulfillment, status, payment route, and zero-value adjustments.',
    object({
      customerQuery: nullableString,
      newCustomer: { anyOf: [customer, { type: 'null' }] },
      placedAt: nullableString,
      channel: nullableString,
      governorate: nullableString,
      fulfillmentMethod: enumSchema(FULFILLMENT_METHODS, true),
      status: nullableString,
      deliveryFee: nonnegativeInteger,
      deliveryCost: nonnegativeInteger,
      orderDiscount: nonnegativeInteger,
      extraCharges: nonnegativeInteger,
      notes: nullableString,
      financeMode: enumSchema(['AUTO', 'NONE', 'CREDIT', 'PAID', 'PARTIAL', 'PROVIDER'], true),
      financeAccountQuery: nullableString,
      financeProviderQuery: nullableString,
      financePaidAmount: { type: ['integer', 'null'], minimum: 0 },
      financePaymentMethod: nullableString,
      financePaymentDate: nullableString,
      financeDueDate: nullableString,
      lines: {
        type: 'array',
        minItems: 1,
        maxItems: 30,
        items: object({
          productQuery: string,
          quantity: { type: 'integer', minimum: 1 },
          unitGrossPrice: { type: ['integer', 'null'], minimum: 0 },
          lineDiscount: nonnegativeInteger,
        }),
      },
    }),
  ),
  tool(
    'prepare_create_expense',
    'Prepare an operating expense for explicit confirmation. Account, category, amount, currency, date, and description are required.',
    object({
      date: nullableString,
      amount: nullableNumber,
      currency: enumSchema(CURRENCIES, true),
      rate: nullableNumber,
      accountQuery: nullableString,
      categoryType: enumSchema(EXPENSE_CATEGORY_TYPES, true),
      partyQuery: nullableString,
      description: nullableString,
      reference: nullableString,
      branchQuery: nullableString,
    }),
  ),
  tool(
    'prepare_create_purchase',
    'Prepare an inventory or fixed-asset purchase for explicit confirmation. Never guess supplier, payment, item, or asset details.',
    object({
      purchaseType: enumSchema(['INVENTORY', 'ASSET'], true),
      date: nullableString,
      totalAmount: nullableNumber,
      currency: enumSchema(CURRENCIES, true),
      rate: nullableNumber,
      quantity: nullableNumber,
      unit: enumSchema(MEASUREMENT_UNITS, true),
      inventoryItemQuery: nullableString,
      newItemNameEn: nullableString,
      newItemNameAr: nullableString,
      newItemCategory: enumSchema(INVENTORY_CATEGORIES, true),
      assetName: nullableString,
      assetCategory: nullableString,
      supplierQuery: nullableString,
      paidMode: enumSchema(['PAID', 'CREDIT', 'PARTIAL'], true),
      paidAmount: nullableNumber,
      accountQuery: nullableString,
      paymentMethod: nullableString,
      paymentDate: nullableString,
      dueDate: nullableString,
      branchQuery: nullableString,
      reference: nullableString,
      notes: nullableString,
    }),
  ),
  tool(
    'prepare_update_order_status',
    'Prepare one order status update for explicit confirmation, including required payment routing for completion.',
    object({
      orderQuery: nullableString,
      status: nullableString,
      completionMode: enumSchema(['AUTO', 'DIRECT', 'PROVIDER'], true),
      accountQuery: nullableString,
      providerKey: nullableString,
      paymentMethod: nullableString,
      date: nullableString,
    }),
  ),
];
