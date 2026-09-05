import 'server-only';
import type { OpenAI } from 'openai';
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

type FunctionTool = OpenAI.Responses.FunctionTool;
type Schema = Record<string, unknown>;

const string: Schema = { type: 'string' };
const nullableString: Schema = { type: ['string', 'null'] };
const nullableNumber: Schema = { type: ['number', 'null'] };
const nullableBoolean: Schema = { type: ['boolean', 'null'] };
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

const partyDetails = object({
  name: nullableString,
  type: enumSchema(PARTY_TYPES, true),
  phone: nullableString,
  email: nullableString,
  address: nullableString,
  notes: nullableString,
});

const ledgerLine = object({
  itemType: enumSchema(['INVENTORY', 'ASSET', 'EXPENSE', 'SERVICE', 'OTHER'], true),
  itemName: nullableString,
  categoryType: enumSchema(EXPENSE_CATEGORY_TYPES, true),
  assetKey: nullableString,
  assetCategory: nullableString,
  inventoryItemQuery: nullableString,
  newItemNameEn: nullableString,
  newItemNameAr: nullableString,
  newItemCategory: enumSchema(INVENTORY_CATEGORIES, true),
  unit: enumSchema(MEASUREMENT_UNITS, true),
  quantity: nullableNumber,
  unitCost: nullableNumber,
  discount: nullableNumber,
  extra: nullableNumber,
  branchQuery: nullableString,
  notes: nullableString,
});

const nullableLedgerLines: Schema = {
  anyOf: [
    { type: 'array', minItems: 1, maxItems: 50, items: ledgerLine },
    { type: 'null' },
  ],
};

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
    'product_buyers',
    'Find customers who bought a product in completed Atlas sale orders. Match by SKU, EAN/internal barcode, Arabic or English product name, alias, or product specifications. Return unique customer names, phones, order counts, units, and product sales for a Baghdad-time period.',
    object({
      productQuery: string,
      range,
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
  ),
  tool(
    'search_orders',
    'Find Atlas orders by order number, customer ID/name/phone, SKU, barcode, product name, or product group.',
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
    'Prepare one or more operating-expense, service, asset, inventory, or review lines for explicit confirmation. Dates default to Baghdad today, currency defaults to IQD, and the configured user default account may be used. Never silently classify OTHER lines.',
    object({
      date: nullableString,
      amount: nullableNumber,
      currency: enumSchema(CURRENCIES, true),
      rate: nullableNumber,
      accountQuery: nullableString,
      categoryType: enumSchema(EXPENSE_CATEGORY_TYPES, true),
      partyQuery: nullableString,
      newParty: { anyOf: [partyDetails, { type: 'null' }] },
      description: nullableString,
      reference: nullableString,
      branchQuery: nullableString,
      lines: nullableLedgerLines,
    }),
  ),
  tool(
    'prepare_create_purchase',
    'Prepare a single or multi-line inventory, fixed-asset, service, or mixed supplier purchase for explicit confirmation. Preserve full supplier details and never guess low-confidence classification or payment routing.',
    object({
      purchaseType: enumSchema(['INVENTORY', 'ASSET', 'MIXED'], true),
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
      newSupplier: { anyOf: [partyDetails, { type: 'null' }] },
      paidMode: enumSchema(['PAID', 'CREDIT', 'PARTIAL'], true),
      paidAmount: nullableNumber,
      accountQuery: nullableString,
      paymentMethod: nullableString,
      paymentDate: nullableString,
      dueDate: nullableString,
      branchQuery: nullableString,
      reference: nullableString,
      notes: nullableString,
      lines: nullableLedgerLines,
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
  tool(
    'prepare_update_customer',
    'Prepare a governed customer update. Preserve every supplied field and never merge differently named customers just because they share a phone number.',
    object({
      customerQuery: nullableString,
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
      reason: nullableString,
    }),
  ),
  tool(
    'prepare_update_party',
    'Prepare a governed supplier, customer-party, shareholder, service provider, employee, or other party update.',
    object({
      partyQuery: nullableString,
      name: nullableString,
      type: enumSchema(PARTY_TYPES, true),
      phone: nullableString,
      email: nullableString,
      address: nullableString,
      notes: nullableString,
      netFeesFromRemittance: nullableBoolean,
      collectsOrderPayments: nullableBoolean,
      reason: nullableString,
    }),
  ),
  tool(
    'prepare_adjust_inventory',
    'Prepare a physical inventory adjustment to an exact target quantity with up to three decimal places. The preview must show current quantity, target quantity, and difference.',
    object({
      inventoryItemQuery: nullableString,
      targetQuantity: nullableNumber,
      occurredAt: nullableString,
      reason: nullableString,
    }),
  ),
  tool(
    'prepare_create_roast_batch',
    'Prepare a roasting batch with optional green-input and roasted-output inventory movements.',
    object({
      batchNumber: nullableString,
      origin: nullableString,
      roastDate: nullableString,
      roastLevel: nullableString,
      greenInputGrams: nullableNumber,
      roastedOutputGrams: nullableNumber,
      qcScore: nullableNumber,
      qcNotes: nullableString,
      greenInventoryItemQuery: nullableString,
      roastedInventoryItemQuery: nullableString,
      branchQuery: nullableString,
    }),
  ),
  tool(
    'prepare_record_payment',
    'Prepare a payment against an Atlas order or an outstanding payable/receivable. A real active finance account is always required; use the user default only when configured.',
    object({
      targetType: enumSchema(['ORDER', 'FINANCE_ENTRY'], true),
      targetQuery: nullableString,
      amount: nullableNumber,
      accountQuery: nullableString,
      paymentMethod: enumSchema(PAYMENT_METHODS, true),
      date: nullableString,
    }),
  ),
  tool(
    'prepare_record_refund',
    'Prepare a refund for an order. This is a high-risk reversible financial correction and requires a second confirmation with the order number.',
    object({
      orderQuery: nullableString,
      amount: nullableNumber,
      accountQuery: nullableString,
      paymentMethod: enumSchema(PAYMENT_METHODS, true),
      date: nullableString,
      reason: nullableString,
    }),
  ),
  tool(
    'prepare_reverse_finance_record',
    'Prepare reversal of one eligible Atlas finance record. This is high risk and requires a second confirmation with its record number.',
    object({ recordQuery: nullableString, reason: nullableString }),
  ),
  tool(
    'prepare_reclassify_spend',
    'Prepare reclassification of one spending line as CAPEX, INVENTORY, OPEX, or REVIEW. This is high risk and requires a second confirmation with its finance record number.',
    object({
      recordQuery: nullableString,
      lineQuery: nullableString,
      spendTreatment: enumSchema(['CAPEX', 'INVENTORY', 'OPEX', 'REVIEW'], true),
      classificationNote: nullableString,
      fixedAssetQuery: nullableString,
      inventoryItemQuery: nullableString,
    }),
  ),
  tool(
    'prepare_dashboard_draft',
    'Prepare a private dashboard draft from a trusted Atlas metric template. Never invent metric IDs.',
    object({
      name: nullableString,
      description: nullableString,
      template: enumSchema([
        'owner-overview',
        'sales-dashboard',
        'inventory-dashboard',
        'delivery-dashboard',
        'financial-dashboard',
        'customer-dashboard',
      ], true),
    }),
  ),
];
