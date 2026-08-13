import 'server-only';
import type { AiPendingActionType, Prisma } from '@prisma/client';
import { normalizeIraqiPhone } from '@/lib/phone';
import { decimalNumber } from '@/lib/decimal';
import { CHANNELS, FULFILLMENT_METHODS, GOVERNORATES, ORDER_STATUSES } from '@/lib/enums';
import { effectivePrice } from '@/lib/metrics/pricing';
import { orderStatusRole, type OrderMetricRole } from '@/lib/metrics/status';
import { invoicePaymentSnapshot } from '@/lib/invoice';
import { prisma } from '@/server/db/client';
import {
  ACTION_DATA_SCHEMAS,
  ResolvedCustomerActionSchema,
  ResolvedExpenseActionSchema,
  ResolvedOrderActionSchema,
  ResolvedOrderStatusActionSchema,
  ResolvedPurchaseActionSchema,
} from './action-data';

type Db = typeof prisma | Prisma.TransactionClient;

type ManagedListState = {
  code: string;
  active: boolean;
  role?: OrderMetricRole;
};

async function managedListState(
  db: Db,
  key: string,
  code: string,
  base: readonly string[],
): Promise<ManagedListState> {
  const override = await db.listOption.findUnique({
    where: { listKey_code: { listKey: key, code } },
    select: { isActive: true, metricRole: true },
  });
  const exists = base.includes(code) || Boolean(override);
  return {
    code,
    active: exists && (override?.isActive ?? true),
    ...(key === 'orderStatus'
      ? { role: (override?.metricRole as OrderMetricRole | null) ?? orderStatusRole(code) }
      : {}),
  };
}

async function lockById(tx: Prisma.TransactionClient, table: 'Product' | 'Customer' | 'FinanceAccount' | 'Party' | 'Branch' | 'InventoryItem' | 'Order', id: string) {
  if (table === 'Product') await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'Customer') await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'FinanceAccount') await tx.$queryRaw`SELECT "id" FROM "FinanceAccount" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'Party') await tx.$queryRaw`SELECT "id" FROM "Party" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'Branch') await tx.$queryRaw`SELECT "id" FROM "Branch" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'InventoryItem') await tx.$queryRaw`SELECT "id" FROM "InventoryItem" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'Order') await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`;
}

async function lockActionRows(tx: Prisma.TransactionClient, type: AiPendingActionType, raw: unknown) {
  if (type === 'CREATE_CUSTOMER') {
    const input = ResolvedCustomerActionSchema.parse(raw);
    const phone = normalizeIraqiPhone(input.phone);
    if (phone) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-phone:${phone}`}))`;
    return;
  }
  if (type === 'CREATE_ORDER') {
    const input = ResolvedOrderActionSchema.parse(raw);
    for (const id of [...new Set(input.lines.map((line) => line.productId))].sort()) await lockById(tx, 'Product', id);
    const items = await tx.inventoryItem.findMany({
      where: { productId: { in: input.lines.map((line) => line.productId) }, isActive: true },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    for (const item of items) await lockById(tx, 'InventoryItem', item.id);
    if (input.customerExternalId) {
      const customer = await tx.customer.findUnique({ where: { externalId: input.customerExternalId }, select: { id: true } });
      if (customer) await lockById(tx, 'Customer', customer.id);
    }
    if (input.newCustomer?.phone) {
      const phone = normalizeIraqiPhone(input.newCustomer.phone);
      if (phone) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-phone:${phone}`}))`;
    }
    if (input.financeAccountId) await lockById(tx, 'FinanceAccount', input.financeAccountId);
    if (input.financeProviderId) await lockById(tx, 'Party', input.financeProviderId);
    const status = await managedListState(tx, 'orderStatus', input.status, ORDER_STATUSES);
    const automatic = await automaticFinanceState(input, status.role ?? 'UNKNOWN', tx);
    if (automatic?.provider?.id) await lockById(tx, 'Party', automatic.provider.id);
    if (automatic?.provider?.defaultSettlementAccountId) {
      await lockById(tx, 'FinanceAccount', automatic.provider.defaultSettlementAccountId);
    }
    if (automatic?.account?.id) await lockById(tx, 'FinanceAccount', automatic.account.id);
    return;
  }
  if (type === 'CREATE_EXPENSE') {
    const input = ResolvedExpenseActionSchema.parse(raw);
    await lockById(tx, 'FinanceAccount', input.accountId);
    if (input.partyId) await lockById(tx, 'Party', input.partyId);
    if (input.branchId) await lockById(tx, 'Branch', input.branchId);
    return;
  }
  if (type === 'CREATE_PURCHASE') {
    const input = ResolvedPurchaseActionSchema.parse(raw);
    if (input.inventoryItemId) await lockById(tx, 'InventoryItem', input.inventoryItemId);
    await lockById(tx, 'Party', input.supplierId);
    if (input.accountId) await lockById(tx, 'FinanceAccount', input.accountId);
    if (input.branchId) await lockById(tx, 'Branch', input.branchId);
    return;
  }
  const input = ResolvedOrderStatusActionSchema.parse(raw);
  await lockById(tx, 'Order', input.orderId);
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: {
      channel: true,
      fulfillmentMethod: true,
      lines: { select: { productId: true } },
    },
  });
  if (order) {
    for (const id of [...new Set(order.lines.map((line) => line.productId))].sort()) {
      await lockById(tx, 'Product', id);
    }
    const items = await tx.inventoryItem.findMany({
      where: { productId: { in: order.lines.map((line) => line.productId) }, isActive: true },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    for (const item of items) await lockById(tx, 'InventoryItem', item.id);
    const target = await managedListState(tx, 'orderStatus', input.status, ORDER_STATUSES);
    const automatic = await automaticFinanceState(
      { channel: order.channel, fulfillmentMethod: order.fulfillmentMethod, financeMode: input.completionMode },
      target.role ?? 'UNKNOWN',
      tx,
    );
    if (automatic?.provider?.id) await lockById(tx, 'Party', automatic.provider.id);
    if (automatic?.provider?.defaultSettlementAccountId) {
      await lockById(tx, 'FinanceAccount', automatic.provider.defaultSettlementAccountId);
    }
    if (automatic?.account?.id) await lockById(tx, 'FinanceAccount', automatic.account.id);
  }
  if (input.accountId) await lockById(tx, 'FinanceAccount', input.accountId);
  if (input.providerKey) {
    const provider = await tx.party.findUnique({ where: { externalKey: input.providerKey }, select: { id: true } });
    if (provider) await lockById(tx, 'Party', provider.id);
  }
  const entries = await tx.financeEntry.findMany({
    where: { OR: [{ orderId: input.orderId }, { settles: { is: { orderId: input.orderId } } }] },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (const entry of entries) {
    await tx.$queryRaw`SELECT "id" FROM "FinanceEntry" WHERE "id" = ${entry.id} FOR UPDATE`;
  }
}

async function customerPreconditions(raw: unknown, db: Db) {
  const input = ResolvedCustomerActionSchema.parse(raw);
  const normalizedPhone = normalizeIraqiPhone(input.phone);
  const possibleDuplicates = normalizedPhone
    ? await db.customer.findMany({
        where: { isActive: true, normalizedPhone },
        select: { id: true, externalId: true, normalizedPhone: true, nameEn: true, nameAr: true, isActive: true },
        orderBy: { id: 'asc' },
      })
    : [];
  return { normalizedPhone, possibleDuplicates };
}

async function productStates(productIds: string[], db: Db) {
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      sku: true,
      sellingPrice: true,
      cogsPerUnit: true,
      sellUnit: true,
      trackInventory: true,
      allowDiscount: true,
      allowPriceOverride: true,
      minSellingPrice: true,
      isActive: true,
      updatedAt: true,
      prices: {
        where: { kind: 'BASE' },
        select: { kind: true, price: true, effectiveFrom: true },
      },
      inventoryItems: {
        where: { isActive: true },
        select: {
          id: true,
          movements: {
            where: {
              OR: [
                { financeEntryId: null },
                { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } },
              ],
            },
            select: { quantity: true },
          },
        },
      },
    },
    orderBy: { id: 'asc' },
  });
  return products.map((product) => ({
    id: product.id,
    sku: product.sku,
    cogsPerUnit: product.cogsPerUnit,
    sellUnit: product.sellUnit,
    trackInventory: product.trackInventory,
    allowDiscount: product.allowDiscount,
    allowPriceOverride: product.allowPriceOverride,
    minSellingPrice: product.minSellingPrice,
    isActive: product.isActive,
    updatedAt: product.updatedAt,
    effectiveSellingPrice: effectivePrice(product.prices, product.sellingPrice),
    availableQuantity: product.inventoryItems.reduce(
      (total, item) => total + item.movements.reduce((sum, movement) => sum + decimalNumber(movement.quantity), 0),
      0,
    ),
    inventoryItems: product.inventoryItems.map((item) => item.id),
  }));
}

async function providerState(db: Db, id?: string | null, externalKey?: string | null) {
  if (!id && !externalKey) return null;
  return db.party.findFirst({
    where: id ? { id } : { externalKey },
    select: {
      id: true,
      externalKey: true,
      isActive: true,
      collectsOrderPayments: true,
      defaultSettlementAccountId: true,
      defaultSettlementAccount: {
        select: { id: true, currency: true, type: true, isActive: true },
      },
    },
  });
}

async function automaticFinanceState(
  input: { channel: string; fulfillmentMethod: string; financeMode: string },
  statusRole: OrderMetricRole,
  db: Db,
) {
  if (input.financeMode !== 'AUTO') return null;
  const providerKey = input.channel === 'ONLINE_STORE'
    ? 'WAYL'
    : statusRole === 'SALE' && input.fulfillmentMethod === 'COURIER'
      ? 'HI_EXPRESS'
      : null;
  if (providerKey) return { mode: 'PROVIDER', providerKey, provider: await providerState(db, null, providerKey) };
  if (statusRole !== 'SALE') return { mode: 'NONE', providerKey: null, provider: null };
  const account = await db.financeAccount.findUnique({
    where: { externalKey: 'CASH_ON_HANDS' },
    select: { id: true, externalKey: true, currency: true, type: true, isActive: true },
  });
  return { mode: 'PAID', providerKey: null, provider: null, account };
}

async function orderPreconditions(raw: unknown, db: Db) {
  const input = ResolvedOrderActionSchema.parse(raw);
  const [products, customer, account, provider, status, channel, governorate, fulfillment] = await Promise.all([
    productStates(input.lines.map((line) => line.productId), db),
    input.customerExternalId
      ? db.customer.findUnique({
          where: { externalId: input.customerExternalId },
          select: { id: true, externalId: true, isActive: true, normalizedPhone: true },
        })
      : Promise.resolve(null),
    input.financeAccountId
      ? db.financeAccount.findUnique({
          where: { id: input.financeAccountId },
          select: { id: true, currency: true, type: true, isActive: true },
        })
      : Promise.resolve(null),
    providerState(db, input.financeProviderId),
    managedListState(db, 'orderStatus', input.status, ORDER_STATUSES),
    managedListState(db, 'channel', input.channel, CHANNELS),
    managedListState(db, 'governorate', input.governorate, GOVERNORATES),
    managedListState(db, 'fulfillment', input.fulfillmentMethod, FULFILLMENT_METHODS),
  ]);
  const newCustomerPhone = normalizeIraqiPhone(input.newCustomer?.phone);
  const possibleNewCustomerDuplicates = newCustomerPhone
    ? await db.customer.findMany({
        where: { isActive: true, normalizedPhone: newCustomerPhone },
        select: { id: true, externalId: true, normalizedPhone: true, isActive: true },
        orderBy: { id: 'asc' },
      })
    : [];
  const automaticFinance = await automaticFinanceState(input, status.role ?? 'UNKNOWN', db);
  return { products, customer, possibleNewCustomerDuplicates, account, provider, automaticFinance, status, channel, governorate, fulfillment };
}

async function expensePreconditions(raw: unknown, db: Db) {
  const input = ResolvedExpenseActionSchema.parse(raw);
  const [account, party, branch] = await Promise.all([
    db.financeAccount.findUnique({
      where: { id: input.accountId },
      select: { id: true, currency: true, type: true, isActive: true },
    }),
    input.partyId
      ? db.party.findUnique({ where: { id: input.partyId }, select: { id: true, type: true, isActive: true } })
      : Promise.resolve(null),
    input.branchId
      ? db.branch.findUnique({ where: { id: input.branchId }, select: { id: true, isActive: true } })
      : Promise.resolve(null),
  ]);
  return { account, party, branch };
}

async function purchasePreconditions(raw: unknown, db: Db) {
  const input = ResolvedPurchaseActionSchema.parse(raw);
  const [item, supplier, account, branch] = await Promise.all([
    input.inventoryItemId
      ? db.inventoryItem.findUnique({
          where: { id: input.inventoryItemId },
          select: { id: true, category: true, unit: true, branchId: true, unitCost: true, isActive: true },
        })
      : Promise.resolve(null),
    db.party.findUnique({ where: { id: input.supplierId }, select: { id: true, type: true, isActive: true } }),
    input.accountId
      ? db.financeAccount.findUnique({
          where: { id: input.accountId },
          select: { id: true, currency: true, type: true, isActive: true },
        })
      : Promise.resolve(null),
    input.branchId
      ? db.branch.findUnique({ where: { id: input.branchId }, select: { id: true, isActive: true } })
      : Promise.resolve(null),
  ]);
  return { item, supplier, account, branch };
}

async function orderStatusPreconditions(raw: unknown, db: Db) {
  const input = ResolvedOrderStatusActionSchema.parse(raw);
  const [order, account, provider, targetStatus] = await Promise.all([
    db.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        channel: true,
        fulfillmentMethod: true,
        placedAt: true,
        grossAmount: true,
        discountAmount: true,
        refundAmount: true,
        deliveryFee: true,
        extraCharges: true,
        inventorySyncMode: true,
        lines: { select: { id: true, productId: true, quantity: true, unitGrossPrice: true, lineDiscount: true } },
      },
    }),
    input.accountId
      ? db.financeAccount.findUnique({
          where: { id: input.accountId },
          select: { id: true, currency: true, type: true, isActive: true },
        })
      : Promise.resolve(null),
    providerState(db, null, input.providerKey),
    managedListState(db, 'orderStatus', input.status, ORDER_STATUSES),
  ]);
  const entries = order
    ? await db.financeEntry.findMany({
        where: { OR: [{ orderId: order.id }, { settles: { is: { orderId: order.id } } }] },
        select: {
          id: true,
          orderId: true,
          type: true,
          amount: true,
          obligation: true,
          obligationKind: true,
          settlesId: true,
          accountId: true,
          partyId: true,
          archivedAt: true,
          reversedAt: true,
          reversalOfId: true,
          date: true,
          paymentMethod: true,
          account: { select: { name: true } },
          party: { select: { id: true, name: true, collectsOrderPayments: true } },
        },
        orderBy: { id: 'asc' },
      })
    : [];
  const currentStatus = order
    ? await managedListState(db, 'orderStatus', order.status, ORDER_STATUSES)
    : null;
  const products = order ? await productStates(order.lines.map((line) => line.productId), db) : [];
  const automaticFinance = order
    ? await automaticFinanceState(
        { channel: order.channel, fulfillmentMethod: order.fulfillmentMethod, financeMode: input.completionMode },
        targetStatus.role ?? 'UNKNOWN',
        db,
      )
    : null;
  const payment = order ? invoicePaymentSnapshot(order, entries) : null;
  return { order, entries, products, payment, account, provider, automaticFinance, currentStatus, targetStatus };
}

export async function loadActionPreconditions(
  type: AiPendingActionType,
  raw: unknown,
  db: Db = prisma,
  options: { lock?: boolean } = {},
) {
  ACTION_DATA_SCHEMAS[type].parse(raw);
  if (options.lock) await lockActionRows(db as Prisma.TransactionClient, type, raw);
  switch (type) {
    case 'CREATE_CUSTOMER':
      return customerPreconditions(raw, db);
    case 'CREATE_ORDER':
      return orderPreconditions(raw, db);
    case 'CREATE_EXPENSE':
      return expensePreconditions(raw, db);
    case 'CREATE_PURCHASE':
      return purchasePreconditions(raw, db);
    case 'UPDATE_ORDER_STATUS':
      return orderStatusPreconditions(raw, db);
  }
}

export type ActionPreconditionIssue = { field: string; code: string; detail?: string };

function invalidAccount(account: { isActive?: boolean; currency?: string; type?: string } | null | undefined): string | null {
  if (!account?.isActive) return 'account_inactive';
  if (account.currency !== 'IQD' || account.type === 'PAYMENT_GATEWAY') return 'account_invalid';
  return null;
}

function invalidProvider(provider: {
  isActive?: boolean;
  collectsOrderPayments?: boolean;
  defaultSettlementAccount?: { isActive?: boolean; currency?: string; type?: string } | null;
} | null | undefined): boolean {
  return !provider?.isActive || !provider.collectsOrderPayments || Boolean(invalidAccount(provider.defaultSettlementAccount));
}

function productIssues(
  products: Array<{
    id: string;
    sku: string;
    isActive: boolean;
    trackInventory: boolean;
    inventoryItems: string[];
    availableQuantity: number;
    effectiveSellingPrice: number;
    allowPriceOverride: boolean;
    minSellingPrice: number | null;
    allowDiscount: boolean;
  }>,
  lines: Array<{ productId: string; quantity: number; unitGrossPrice: number; lineDiscount: number }>,
  requireStock: boolean,
): ActionPreconditionIssue[] {
  const issues: ActionPreconditionIssue[] = [];
  if (products.length !== new Set(lines.map((line) => line.productId)).size) {
    issues.push({ field: 'lines', code: 'product_missing' });
  }
  const required = new Map<string, number>();
  for (const line of lines) required.set(line.productId, (required.get(line.productId) ?? 0) + line.quantity);
  for (const product of products) {
    if (!product.isActive) issues.push({ field: 'lines', code: 'product_inactive', detail: product.sku });
    if (requireStock && product.trackInventory && product.inventoryItems.length === 0) {
      issues.push({ field: 'lines', code: 'stock_not_configured', detail: product.sku });
    }
    if (requireStock && product.trackInventory && product.inventoryItems.length > 1) {
      issues.push({ field: 'lines', code: 'stock_configuration_ambiguous', detail: product.sku });
    }
    const needed = required.get(product.id) ?? 0;
    if (requireStock && product.trackInventory && product.inventoryItems.length === 1 && product.availableQuantity < needed) {
      issues.push({ field: 'lines', code: 'stock_insufficient', detail: `${product.sku}:${product.availableQuantity}:${needed}` });
    }
    for (const line of lines.filter((row) => row.productId === product.id)) {
      if (!product.allowPriceOverride && line.unitGrossPrice !== product.effectiveSellingPrice) {
        issues.push({ field: 'lines', code: 'price_override_not_allowed', detail: product.sku });
      }
      if (product.minSellingPrice != null && line.unitGrossPrice < product.minSellingPrice) {
        issues.push({ field: 'lines', code: 'price_below_minimum', detail: product.sku });
      }
      if (!product.allowDiscount && line.lineDiscount > 0) {
        issues.push({ field: 'lines', code: 'discount_not_allowed', detail: product.sku });
      }
      if (line.lineDiscount > line.unitGrossPrice * line.quantity) {
        issues.push({ field: 'lines', code: 'discount_exceeds_line_total', detail: product.sku });
      }
    }
  }
  return issues;
}

export function actionPreconditionIssues(
  type: AiPendingActionType,
  raw: unknown,
  preconditions: Awaited<ReturnType<typeof loadActionPreconditions>>,
): ActionPreconditionIssue[] {
  const state = preconditions as Record<string, unknown>;
  const issues: ActionPreconditionIssue[] = [];
  if (type === 'CREATE_CUSTOMER') {
    if (Array.isArray(state.possibleDuplicates) && state.possibleDuplicates.length) issues.push({ field: 'phone', code: 'customer_duplicate' });
    return issues;
  }
  if (type === 'CREATE_ORDER') {
    const input = ResolvedOrderActionSchema.parse(raw);
    const status = state.status as ManagedListState | undefined;
    const products = (Array.isArray(state.products) ? state.products : []) as Parameters<typeof productIssues>[0];
    issues.push(...productIssues(products, input.lines, status?.role === 'SALE'));
    if (!(state.channel as ManagedListState | undefined)?.active) issues.push({ field: 'channel', code: 'channel_invalid' });
    if (!(state.governorate as ManagedListState | undefined)?.active) issues.push({ field: 'governorate', code: 'governorate_invalid' });
    if (!(state.fulfillment as ManagedListState | undefined)?.active) issues.push({ field: 'fulfillmentMethod', code: 'fulfillment_invalid' });
    if (!status?.active || status.role === 'UNKNOWN') issues.push({ field: 'status', code: 'status_invalid' });
    const customer = state.customer as { isActive?: boolean } | null;
    if (input.customerExternalId && (!customer || !customer.isActive)) issues.push({ field: 'customerQuery', code: 'customer_inactive' });
    if (Array.isArray(state.possibleNewCustomerDuplicates) && state.possibleNewCustomerDuplicates.length) {
      issues.push({ field: 'newCustomer.phone', code: 'customer_duplicate' });
    }
    if (input.financeMode === 'PAID' || input.financeMode === 'PARTIAL') {
      const code = invalidAccount(state.account as Parameters<typeof invalidAccount>[0]);
      if (code) issues.push({ field: 'financeAccountQuery', code });
      if (!input.financePaymentDate) issues.push({ field: 'financePaymentDate', code: 'payment_date_required' });
    }
    if (input.financeMode === 'PROVIDER' && invalidProvider(state.provider as Parameters<typeof invalidProvider>[0])) {
      issues.push({ field: 'financeProviderQuery', code: 'provider_invalid' });
    }
    const automatic = state.automaticFinance as { mode?: string; provider?: Parameters<typeof invalidProvider>[0]; account?: Parameters<typeof invalidAccount>[0] } | null;
    if (input.financeMode === 'AUTO' && automatic?.mode === 'PROVIDER' && invalidProvider(automatic.provider)) {
      issues.push({ field: 'financeMode', code: 'provider_invalid' });
    }
    if (input.financeMode === 'AUTO' && automatic?.mode === 'PAID') {
      const code = invalidAccount(automatic.account);
      if (code) issues.push({ field: 'financeMode', code });
    }
    const total = Math.max(
      0,
      input.lines.reduce((sum, line) => sum + line.unitGrossPrice * line.quantity - line.lineDiscount, 0) - input.orderDiscount + input.deliveryFee + input.extraCharges,
    );
    if (input.financeMode === 'PARTIAL' && (!input.financePaidAmount || input.financePaidAmount >= total)) {
      issues.push({ field: 'financePaidAmount', code: 'partial_payment_invalid' });
    }
    if ((input.financeMode === 'CREDIT' || input.financeMode === 'PARTIAL') && !input.financeDueDate) {
      issues.push({ field: 'financeDueDate', code: 'due_date_required' });
    }
    if (status?.role === 'SALE' && total > 0 && !['PAID', 'PROVIDER', 'AUTO'].includes(input.financeMode)) {
      issues.push({ field: 'financeMode', code: 'payment_required' });
    }
    return issues;
  }
  if (type === 'CREATE_EXPENSE') {
    const input = ResolvedExpenseActionSchema.parse(raw);
    const code = invalidAccount(state.account as Parameters<typeof invalidAccount>[0]);
    if (code) issues.push({ field: 'accountQuery', code });
    const party = state.party as { isActive?: boolean } | null;
    if (input.partyId && !party?.isActive) issues.push({ field: 'partyQuery', code: 'party_inactive' });
    const branch = state.branch as { isActive?: boolean } | null;
    if (input.branchId && !branch?.isActive) issues.push({ field: 'branchQuery', code: 'branch_inactive' });
    return issues;
  }
  if (type === 'CREATE_PURCHASE') {
    const input = ResolvedPurchaseActionSchema.parse(raw);
    const item = state.item as { id?: string; isActive?: boolean; unit?: string; branchId?: string | null } | null;
    if (input.inventoryItemId && (!item?.id || !item.isActive)) issues.push({ field: 'inventoryItemQuery', code: 'inventory_item_missing' });
    if (input.inventoryItemId && item?.unit !== input.unit) issues.push({ field: 'unit', code: 'inventory_unit_mismatch' });
    if (input.inventoryItemId && input.branchId && item?.branchId && item.branchId !== input.branchId) {
      issues.push({ field: 'branchQuery', code: 'inventory_branch_mismatch' });
    }
    const supplier = state.supplier as { isActive?: boolean; type?: string } | null;
    if (!supplier?.isActive || supplier.type !== 'SUPPLIER') issues.push({ field: 'supplierQuery', code: 'supplier_invalid' });
    if (input.paidMode === 'PAID' || input.paidMode === 'PARTIAL') {
      const code = invalidAccount(state.account as Parameters<typeof invalidAccount>[0]);
      if (code) issues.push({ field: 'accountQuery', code });
      if (!input.paymentDate) issues.push({ field: 'paymentDate', code: 'payment_date_required' });
    }
    if (input.paidMode === 'PARTIAL' && (!input.paidAmount || input.paidAmount >= input.totalAmount)) {
      issues.push({ field: 'paidAmount', code: 'partial_payment_invalid' });
    }
    if ((input.paidMode === 'CREDIT' || input.paidMode === 'PARTIAL') && !input.dueDate) {
      issues.push({ field: 'dueDate', code: 'due_date_required' });
    }
    const branch = state.branch as { isActive?: boolean } | null;
    if (input.branchId && !branch?.isActive) issues.push({ field: 'branchQuery', code: 'branch_inactive' });
    return issues;
  }
  const input = ResolvedOrderStatusActionSchema.parse(raw);
  const order = state.order as {
    id?: string;
    status?: string;
    inventorySyncMode?: string;
    lines?: Array<{ productId: string; quantity: number; unitGrossPrice: number; lineDiscount: number }>;
  } | null;
  if (!order) issues.push({ field: 'orderQuery', code: 'order_missing' });
  const target = state.targetStatus as ManagedListState | undefined;
  if (!target?.active || target.role === 'UNKNOWN') issues.push({ field: 'status', code: 'status_invalid' });
  const payment = state.payment as { paid?: number; remaining?: number } | null;
  if (payment?.paid && (target?.role === 'RETURN' || target?.role === 'CANCELED')) {
    issues.push({ field: 'status', code: 'refund_required' });
  }
  if (target?.role === 'SALE' && (payment?.remaining ?? 0) > 0) {
    if (input.completionMode === 'DIRECT') {
      const code = invalidAccount(state.account as Parameters<typeof invalidAccount>[0]);
      if (code) issues.push({ field: 'accountQuery', code });
      if (!input.date) issues.push({ field: 'date', code: 'payment_date_required' });
    }
    if (input.completionMode === 'PROVIDER' && invalidProvider(state.provider as Parameters<typeof invalidProvider>[0])) {
      issues.push({ field: 'providerKey', code: 'provider_invalid' });
    }
    const automatic = state.automaticFinance as { mode?: string; provider?: Parameters<typeof invalidProvider>[0]; account?: Parameters<typeof invalidAccount>[0] } | null;
    if (input.completionMode === 'AUTO' && automatic?.mode === 'PROVIDER' && invalidProvider(automatic.provider)) {
      issues.push({ field: 'completionMode', code: 'provider_invalid' });
    }
    if (input.completionMode === 'AUTO' && automatic?.mode === 'PAID') {
      const code = invalidAccount(automatic.account);
      if (code) issues.push({ field: 'completionMode', code });
    }
  }
  const current = state.currentStatus as ManagedListState | null;
  if (order && current?.role !== 'SALE' && target?.role === 'SALE' && order.inventorySyncMode === 'NORMAL') {
    const products = (Array.isArray(state.products) ? state.products : []) as Parameters<typeof productIssues>[0];
    issues.push(...productIssues(products, order.lines ?? [], true));
  }
  return issues;
}
