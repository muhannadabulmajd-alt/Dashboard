import 'server-only';
import type { AiPendingActionType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { normalizeIraqiPhone } from '@/lib/phone';
import { decimalNumber } from '@/lib/decimal';
import { toMinor } from '@/lib/money';
import { CHANNELS, FULFILLMENT_METHODS, GOVERNORATES, ORDER_STATUSES } from '@/lib/enums';
import { effectivePrice } from '@/lib/metrics/pricing';
import { orderStatusRole, type OrderMetricRole } from '@/lib/metrics/status';
import { invoicePaymentSnapshot } from '@/lib/invoice';
import { prisma } from '@/server/db/client';
import { compatibleCustomerMatches, normalizeCustomerName } from '@/server/commands/customers';
import {
  ACTION_DATA_SCHEMAS,
  ResolvedCustomerActionSchema,
  ResolvedCustomerUpdateActionSchema,
  ResolvedDashboardDraftActionSchema,
  ResolvedExpenseActionSchema,
  ResolvedInventoryAdjustmentActionSchema,
  ResolvedOrderActionSchema,
  ResolvedOrderStatusActionSchema,
  ResolvedPartyActionSchema,
  ResolvedPartyUpdateActionSchema,
  ResolvedPaymentActionSchema,
  ResolvedPurchaseActionSchema,
  ResolvedRefundActionSchema,
  ResolvedReversalActionSchema,
  ResolvedRoastBatchActionSchema,
  ResolvedSpendReclassificationActionSchema,
  ResolvedTransferActionSchema,
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

async function lockById(tx: Prisma.TransactionClient, table: 'Product' | 'Customer' | 'FinanceAccount' | 'FinanceEntry' | 'LedgerEntryLine' | 'Party' | 'Branch' | 'InventoryItem' | 'Order', id: string) {
  if (table === 'Product') await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'Customer') await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'FinanceAccount') await tx.$queryRaw`SELECT "id" FROM "FinanceAccount" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'FinanceEntry') await tx.$queryRaw`SELECT "id" FROM "FinanceEntry" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'LedgerEntryLine') await tx.$queryRaw`SELECT "id" FROM "LedgerEntryLine" WHERE "id" = ${id} FOR UPDATE`;
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
    if (input.customerEnrichment?.phone) {
      const phone = normalizeIraqiPhone(input.customerEnrichment.phone);
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
    if (input.newParty) await lockNewParty(tx, input.newParty);
    if (input.branchId) await lockById(tx, 'Branch', input.branchId);
    for (const line of input.lines ?? []) {
      if (line.inventoryItemId) await lockById(tx, 'InventoryItem', line.inventoryItemId);
      if (line.branchId) await lockById(tx, 'Branch', line.branchId);
    }
    return;
  }
  if (type === 'CREATE_PURCHASE') {
    const input = ResolvedPurchaseActionSchema.parse(raw);
    if (input.inventoryItemId) await lockById(tx, 'InventoryItem', input.inventoryItemId);
    if (input.supplierId) await lockById(tx, 'Party', input.supplierId);
    if (input.newSupplier) await lockNewParty(tx, input.newSupplier);
    if (input.accountId) await lockById(tx, 'FinanceAccount', input.accountId);
    if (input.branchId) await lockById(tx, 'Branch', input.branchId);
    for (const line of input.lines ?? []) {
      if (line.inventoryItemId) await lockById(tx, 'InventoryItem', line.inventoryItemId);
      if (line.branchId) await lockById(tx, 'Branch', line.branchId);
    }
    return;
  }
  if (type === 'CREATE_TRANSFER') {
    const input = ResolvedTransferActionSchema.parse(raw);
    for (const id of [input.fromAccountId, input.toAccountId].sort()) {
      await lockById(tx, 'FinanceAccount', id);
    }
    return;
  }
  if (type === 'UPDATE_CUSTOMER') {
    const input = ResolvedCustomerUpdateActionSchema.parse(raw);
    await lockById(tx, 'Customer', input.customerId);
    const phone = normalizeIraqiPhone(input.phone);
    if (phone) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-phone:${phone}`}))`;
    return;
  }
  if (type === 'UPDATE_PARTY') {
    const input = ResolvedPartyUpdateActionSchema.parse(raw);
    await lockById(tx, 'Party', input.partyId);
    return;
  }
  if (type === 'ADJUST_INVENTORY') {
    const input = ResolvedInventoryAdjustmentActionSchema.parse(raw);
    await lockById(tx, 'InventoryItem', input.inventoryItemId);
    return;
  }
  if (type === 'CREATE_ROAST_BATCH') {
    const input = ResolvedRoastBatchActionSchema.parse(raw);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`roast-batch:${input.batchNumber}`}))`;
    if (input.greenInventoryItemId) await lockById(tx, 'InventoryItem', input.greenInventoryItemId);
    if (input.roastedInventoryItemId) await lockById(tx, 'InventoryItem', input.roastedInventoryItemId);
    if (input.branchId) await lockById(tx, 'Branch', input.branchId);
    return;
  }
  if (type === 'RECORD_PAYMENT') {
    const input = ResolvedPaymentActionSchema.parse(raw);
    await lockById(tx, input.targetType === 'ORDER' ? 'Order' : 'FinanceEntry', input.targetId);
    await lockById(tx, 'FinanceAccount', input.accountId);
    return;
  }
  if (type === 'RECORD_REFUND') {
    const input = ResolvedRefundActionSchema.parse(raw);
    await lockById(tx, 'Order', input.orderId);
    await lockById(tx, 'FinanceAccount', input.accountId);
    return;
  }
  if (type === 'REVERSE_RECORD') {
    const input = ResolvedReversalActionSchema.parse(raw);
    await lockById(tx, 'FinanceEntry', input.financeEntryId);
    return;
  }
  if (type === 'RECLASSIFY_SPEND') {
    const input = ResolvedSpendReclassificationActionSchema.parse(raw);
    await lockById(tx, 'FinanceEntry', input.entryId);
    await lockById(tx, 'LedgerEntryLine', input.lineId);
    if (input.inventoryItemId) await lockById(tx, 'InventoryItem', input.inventoryItemId);
    return;
  }
  if (type === 'CREATE_DASHBOARD_DRAFT') {
    const input = ResolvedDashboardDraftActionSchema.parse(raw);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dashboard-draft:${input.name}`}))`;
    return;
  }
  if (type !== 'UPDATE_ORDER_STATUS') throw new Error('action_not_supported');
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

async function lockNewParty(
  tx: Prisma.TransactionClient,
  raw: z.infer<typeof ResolvedPartyActionSchema>,
) {
  const party = ResolvedPartyActionSchema.parse(raw);
  const key = normalizeIraqiPhone(party.phone) || normalizeCustomerName(party.name);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`party:${party.type}:${key}`}))`;
}

async function newPartyPreconditions(
  raw: z.infer<typeof ResolvedPartyActionSchema> | null,
  db: Db,
) {
  if (!raw) return { matches: [], branch: null, settlementAccount: null };
  const party = ResolvedPartyActionSchema.parse(raw);
  const normalizedName = normalizeCustomerName(party.name);
  const normalizedPhone = normalizeIraqiPhone(party.phone);
  const candidates = await db.party.findMany({
    where: { type: party.type, isActive: true },
    select: { id: true, name: true, phone: true },
    orderBy: { createdAt: 'asc' },
  });
  const matches = candidates.filter((candidate) => {
    const candidatePhone = normalizeIraqiPhone(candidate.phone);
    return normalizeCustomerName(candidate.name) === normalizedName
      && (!normalizedPhone || !candidatePhone || normalizedPhone === candidatePhone);
  });
  const [branch, settlementAccount] = await Promise.all([
    party.branchId
      ? db.branch.findUnique({ where: { id: party.branchId }, select: { id: true, isActive: true } })
      : Promise.resolve(null),
    party.defaultSettlementAccountId
      ? db.financeAccount.findUnique({
          where: { id: party.defaultSettlementAccountId },
          select: { id: true, isActive: true, currency: true, type: true },
        })
      : Promise.resolve(null),
  ]);
  return { matches, branch, settlementAccount };
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
          select: {
            id: true,
            externalId: true,
            isActive: true,
            nameEn: true,
            nameAr: true,
            phone: true,
            normalizedPhone: true,
            email: true,
            governorate: true,
            address1: true,
            street: true,
            notes: true,
            campaignSource: true,
            segment: true,
          },
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
        select: { id: true, externalId: true, nameEn: true, nameAr: true, normalizedPhone: true, isActive: true },
        orderBy: { id: 'asc' },
      })
    : [];
  const enrichmentPhone = normalizeIraqiPhone(input.customerEnrichment?.phone);
  const possibleCustomerEnrichmentDuplicates = enrichmentPhone && customer
    ? await db.customer.findMany({
        where: { isActive: true, normalizedPhone: enrichmentPhone, id: { not: customer.id } },
        select: { id: true, externalId: true, nameEn: true, nameAr: true, normalizedPhone: true, isActive: true },
        orderBy: { id: 'asc' },
      })
    : [];
  const automaticFinance = await automaticFinanceState(input, status.role ?? 'UNKNOWN', db);
  return {
    products,
    customer,
    possibleNewCustomerDuplicates,
    possibleCustomerEnrichmentDuplicates,
    account,
    provider,
    automaticFinance,
    status,
    channel,
    governorate,
    fulfillment,
  };
}

async function expensePreconditions(raw: unknown, db: Db) {
  const input = ResolvedExpenseActionSchema.parse(raw);
  const [account, party, branch, newParty, lines] = await Promise.all([
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
    newPartyPreconditions(input.newParty, db),
    Promise.all((input.lines ?? []).map(async (line) => ({
      item: line.inventoryItemId
        ? await db.inventoryItem.findUnique({
            where: { id: line.inventoryItemId },
            select: { id: true, isActive: true, unit: true, branchId: true },
          })
        : null,
      branch: line.branchId
        ? await db.branch.findUnique({ where: { id: line.branchId }, select: { id: true, isActive: true } })
        : null,
    }))),
  ]);
  return { account, party, branch, newParty, lines };
}

async function purchasePreconditions(raw: unknown, db: Db) {
  const input = ResolvedPurchaseActionSchema.parse(raw);
  const [item, supplier, account, branch, newSupplier, lines] = await Promise.all([
    input.inventoryItemId
      ? db.inventoryItem.findUnique({
          where: { id: input.inventoryItemId },
          select: { id: true, category: true, unit: true, branchId: true, unitCost: true, isActive: true },
        })
      : Promise.resolve(null),
    input.supplierId
      ? db.party.findUnique({ where: { id: input.supplierId }, select: { id: true, type: true, isActive: true } })
      : Promise.resolve(null),
    input.accountId
      ? db.financeAccount.findUnique({
          where: { id: input.accountId },
          select: { id: true, currency: true, type: true, isActive: true },
        })
      : Promise.resolve(null),
    input.branchId
      ? db.branch.findUnique({ where: { id: input.branchId }, select: { id: true, isActive: true } })
      : Promise.resolve(null),
    newPartyPreconditions(input.newSupplier, db),
    Promise.all((input.lines ?? []).map(async (line) => ({
      item: line.inventoryItemId
        ? await db.inventoryItem.findUnique({
            where: { id: line.inventoryItemId },
            select: { id: true, isActive: true, unit: true, branchId: true },
          })
        : null,
      branch: line.branchId
        ? await db.branch.findUnique({ where: { id: line.branchId }, select: { id: true, isActive: true } })
        : null,
    }))),
  ]);
  return { item, supplier, account, branch, newSupplier, lines };
}

async function transferPreconditions(raw: unknown, db: Db) {
  const input = ResolvedTransferActionSchema.parse(raw);
  const [fromAccount, toAccount] = await Promise.all([
    db.financeAccount.findUnique({
      where: { id: input.fromAccountId },
      select: { id: true, name: true, currency: true, type: true, isActive: true },
    }),
    db.financeAccount.findUnique({
      where: { id: input.toAccountId },
      select: { id: true, name: true, currency: true, type: true, isActive: true },
    }),
  ]);
  return { fromAccount, toAccount };
}

async function customerUpdatePreconditions(raw: unknown, db: Db) {
  const input = ResolvedCustomerUpdateActionSchema.parse(raw);
  const customer = await db.customer.findUnique({
    where: { id: input.customerId },
    select: {
      id: true,
      externalId: true,
      isActive: true,
      nameEn: true,
      nameAr: true,
      phone: true,
      normalizedPhone: true,
      email: true,
      governorate: true,
      address1: true,
      street: true,
      notes: true,
      segment: true,
      campaignSource: true,
    },
  });
  const normalizedPhone = input.phone === undefined ? undefined : normalizeIraqiPhone(input.phone);
  const samePhone = normalizedPhone
    ? await db.customer.findMany({
        where: { normalizedPhone, isActive: true, id: { not: input.customerId } },
        select: { id: true, nameEn: true, nameAr: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  return { customer, normalizedPhone, samePhone };
}

async function partyUpdatePreconditions(raw: unknown, db: Db) {
  const input = ResolvedPartyUpdateActionSchema.parse(raw);
  const [party, branch, settlementAccount] = await Promise.all([
    db.party.findUnique({ where: { id: input.partyId } }),
    input.branchId
      ? db.branch.findUnique({ where: { id: input.branchId }, select: { id: true, isActive: true } })
      : Promise.resolve(null),
    input.defaultSettlementAccountId
      ? db.financeAccount.findUnique({
          where: { id: input.defaultSettlementAccountId },
          select: { id: true, isActive: true, currency: true, type: true },
        })
      : Promise.resolve(null),
  ]);
  return { party, branch, settlementAccount };
}

async function inventoryAdjustmentPreconditions(raw: unknown, db: Db) {
  const input = ResolvedInventoryAdjustmentActionSchema.parse(raw);
  const item = await db.inventoryItem.findUnique({
    where: { id: input.inventoryItemId },
    select: {
      id: true,
      nameEn: true,
      nameAr: true,
      unit: true,
      isActive: true,
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
  });
  const currentQuantity = item?.movements.reduce(
    (sum, movement) => sum + decimalNumber(movement.quantity),
    0,
  ) ?? null;
  return { item: item ? { ...item, movements: undefined } : null, currentQuantity };
}

async function roastBatchPreconditions(raw: unknown, db: Db) {
  const input = ResolvedRoastBatchActionSchema.parse(raw);
  const [existing, green, roasted, branch] = await Promise.all([
    db.roastBatch.findUnique({ where: { batchNumber: input.batchNumber }, select: { id: true } }),
    input.greenInventoryItemId
      ? db.inventoryItem.findUnique({
          where: { id: input.greenInventoryItemId },
          select: { id: true, category: true, unit: true, isActive: true, movements: { select: { quantity: true } } },
        })
      : Promise.resolve(null),
    input.roastedInventoryItemId
      ? db.inventoryItem.findUnique({
          where: { id: input.roastedInventoryItemId },
          select: { id: true, category: true, unit: true, isActive: true },
        })
      : Promise.resolve(null),
    input.branchId
      ? db.branch.findUnique({ where: { id: input.branchId }, select: { id: true, isActive: true } })
      : Promise.resolve(null),
  ]);
  const greenAvailable = green?.movements.reduce(
    (sum, movement) => sum + decimalNumber(movement.quantity),
    0,
  ) ?? null;
  return {
    existing,
    green: green ? { ...green, movements: undefined } : null,
    greenAvailable,
    roasted,
    branch,
  };
}

const invoiceEntrySelect = {
  id: true,
  orderId: true,
  type: true,
  amount: true,
  obligation: true,
  obligationKind: true,
  settlesId: true,
  archivedAt: true,
  reversedAt: true,
  reversalOfId: true,
  date: true,
  paymentMethod: true,
  account: { select: { name: true } },
  party: { select: { id: true, name: true, collectsOrderPayments: true } },
} satisfies Prisma.FinanceEntrySelect;

async function paymentPreconditions(raw: unknown, db: Db) {
  const input = ResolvedPaymentActionSchema.parse(raw);
  const account = await db.financeAccount.findUnique({
    where: { id: input.accountId },
    select: { id: true, isActive: true, currency: true, type: true },
  });
  if (input.targetType === 'ORDER') {
    const order = await db.order.findUnique({
      where: { id: input.targetId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        grossAmount: true,
        discountAmount: true,
        refundAmount: true,
        deliveryFee: true,
        extraCharges: true,
        currency: true,
      },
    });
    const entries = order
      ? await db.financeEntry.findMany({
          where: { OR: [{ orderId: order.id }, { settles: { is: { orderId: order.id } } }] },
          select: invoiceEntrySelect,
          orderBy: { id: 'asc' },
        })
      : [];
    return { account, order, payment: order ? invoicePaymentSnapshot(order, entries) : null, obligation: null, outstanding: null };
  }
  const obligation = await db.financeEntry.findUnique({
    where: { id: input.targetId },
    include: {
      settlements: {
        where: { archivedAt: null, reversedAt: null, reversalOfId: null },
        select: { amount: true },
      },
    },
  });
  const outstanding = obligation
    ? Math.max(0, obligation.amount - obligation.settlements.reduce((sum, row) => sum + row.amount, 0))
    : null;
  return { account, order: null, payment: null, obligation, outstanding };
}

async function refundPreconditions(raw: unknown, db: Db) {
  const input = ResolvedRefundActionSchema.parse(raw);
  const [order, account] = await Promise.all([
    db.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        grossAmount: true,
        discountAmount: true,
        refundAmount: true,
        deliveryFee: true,
        extraCharges: true,
        currency: true,
      },
    }),
    db.financeAccount.findUnique({
      where: { id: input.accountId },
      select: { id: true, isActive: true, currency: true, type: true },
    }),
  ]);
  const entries = order
    ? await db.financeEntry.findMany({
        where: { OR: [{ orderId: order.id }, { settles: { is: { orderId: order.id } } }] },
        select: invoiceEntrySelect,
        orderBy: { id: 'asc' },
      })
    : [];
  const payment = order ? invoicePaymentSnapshot(order, entries) : null;
  const originalTotal = order
    ? Math.max(0, order.grossAmount - order.discountAmount + order.deliveryFee + order.extraCharges)
    : 0;
  const refundable = order && payment
    ? Math.min(payment.paidRaw, Math.max(0, originalTotal - order.refundAmount))
    : 0;
  return { order, account, payment, refundable };
}

async function reversalPreconditions(raw: unknown, db: Db) {
  const input = ResolvedReversalActionSchema.parse(raw);
  const entry = await db.financeEntry.findUnique({
    where: { id: input.financeEntryId },
    select: {
      id: true,
      recordKey: true,
      importKey: true,
      reversedAt: true,
      reversalOfId: true,
      archivedAt: true,
      settlements: { where: { archivedAt: null, reversedAt: null, reversalOfId: null }, select: { id: true } },
    },
  });
  return { entry };
}

async function reclassificationPreconditions(raw: unknown, db: Db) {
  const input = ResolvedSpendReclassificationActionSchema.parse(raw);
  const [line, asset, item] = await Promise.all([
    db.ledgerEntryLine.findFirst({
      where: { id: input.lineId, financeEntryId: input.entryId },
      select: {
        id: true,
        financeEntryId: true,
        itemName: true,
        spendTreatment: true,
        classificationStatus: true,
        inventoryItemId: true,
        lineTotal: true,
        createdAt: true,
      },
    }),
    input.fixedAssetId
      ? db.fixedAsset.findUnique({ where: { id: input.fixedAssetId }, select: { id: true, isActive: true } })
      : Promise.resolve(null),
    input.inventoryItemId
      ? db.inventoryItem.findUnique({ where: { id: input.inventoryItemId }, select: { id: true, isActive: true } })
      : Promise.resolve(null),
  ]);
  return { line, asset, item };
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
  const schema = ACTION_DATA_SCHEMAS[type];
  if (!schema) throw new Error('action_not_supported');
  schema.parse(raw);
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
    case 'CREATE_TRANSFER':
      return transferPreconditions(raw, db);
    case 'UPDATE_ORDER_STATUS':
      return orderStatusPreconditions(raw, db);
    case 'UPDATE_CUSTOMER':
      return customerUpdatePreconditions(raw, db);
    case 'UPDATE_PARTY':
      return partyUpdatePreconditions(raw, db);
    case 'ADJUST_INVENTORY':
      return inventoryAdjustmentPreconditions(raw, db);
    case 'CREATE_ROAST_BATCH':
      return roastBatchPreconditions(raw, db);
    case 'RECORD_PAYMENT':
      return paymentPreconditions(raw, db);
    case 'RECORD_REFUND':
      return refundPreconditions(raw, db);
    case 'REVERSE_RECORD':
      return reversalPreconditions(raw, db);
    case 'RECLASSIFY_SPEND':
      return reclassificationPreconditions(raw, db);
    case 'CREATE_DASHBOARD_DRAFT':
      return { name: ResolvedDashboardDraftActionSchema.parse(raw).name };
    default:
      throw new Error('action_not_supported');
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
  if (!ACTION_DATA_SCHEMAS[type]) {
    return [{ field: 'action', code: 'action_not_supported' }];
  }
  const state = preconditions as Record<string, unknown>;
  const issues: ActionPreconditionIssue[] = [];
  if (type === 'CREATE_CUSTOMER') {
    const input = ResolvedCustomerActionSchema.parse(raw);
    const candidates = Array.isArray(state.possibleDuplicates)
      ? state.possibleDuplicates as Array<{ id: string; nameEn: string | null; nameAr: string | null }>
      : [];
    if (compatibleCustomerMatches(input, candidates).length > 1) {
      issues.push({ field: 'phone', code: 'customer_match_ambiguous' });
    }
    return issues;
  }
  if (type === 'CREATE_ORDER') {
    const input = ResolvedOrderActionSchema.parse(raw);
    const status = state.status as ManagedListState | undefined;
    const products = (Array.isArray(state.products) ? state.products : []) as Parameters<typeof productIssues>[0];
    issues.push(...productIssues(products, input.lines, status?.role === 'SALE').filter(
      (issue) => issue.code !== 'stock_not_configured',
    ));
    if (!(state.channel as ManagedListState | undefined)?.active) issues.push({ field: 'channel', code: 'channel_invalid' });
    if (!(state.governorate as ManagedListState | undefined)?.active) issues.push({ field: 'governorate', code: 'governorate_invalid' });
    if (!(state.fulfillment as ManagedListState | undefined)?.active) issues.push({ field: 'fulfillmentMethod', code: 'fulfillment_invalid' });
    if (!status?.active || status.role === 'UNKNOWN') issues.push({ field: 'status', code: 'status_invalid' });
    const customer = state.customer as { id?: string; isActive?: boolean; nameEn?: string | null; nameAr?: string | null } | null;
    if (input.customerExternalId && (!customer || !customer.isActive)) issues.push({ field: 'customerQuery', code: 'customer_inactive' });
    const possibleCustomers = Array.isArray(state.possibleNewCustomerDuplicates)
      ? state.possibleNewCustomerDuplicates as Array<{ id: string; nameEn: string | null; nameAr: string | null }>
      : [];
    if (input.newCustomer && compatibleCustomerMatches(input.newCustomer, possibleCustomers).length > 1) {
      issues.push({ field: 'newCustomer.phone', code: 'customer_match_ambiguous' });
    }
    if (input.customerEnrichment && customer && compatibleCustomerMatches(input.customerEnrichment, [customer]).length !== 1) {
      issues.push({ field: 'newCustomer', code: 'customer_name_conflict' });
    }
    const enrichmentDuplicates = Array.isArray(state.possibleCustomerEnrichmentDuplicates)
      ? state.possibleCustomerEnrichmentDuplicates as Array<{ id: string; nameEn: string | null; nameAr: string | null }>
      : [];
    if (input.customerEnrichment && compatibleCustomerMatches({
      nameEn: input.customerEnrichment.nameEn ?? customer?.nameEn ?? undefined,
      nameAr: input.customerEnrichment.nameAr ?? customer?.nameAr ?? undefined,
    }, enrichmentDuplicates).length) {
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
    const newParty = state.newParty as {
      matches?: unknown[];
      branch?: { isActive?: boolean } | null;
      settlementAccount?: Parameters<typeof invalidAccount>[0];
    } | undefined;
    if ((newParty?.matches?.length ?? 0) > 1) issues.push({ field: 'partyQuery', code: 'party_match_ambiguous' });
    if (input.newParty?.branchId && !newParty?.branch?.isActive) issues.push({ field: 'partyQuery', code: 'branch_inactive' });
    if (input.newParty?.defaultSettlementAccountId && invalidAccount(newParty?.settlementAccount)) {
      issues.push({ field: 'partyQuery', code: 'account_invalid' });
    }
    const branch = state.branch as { isActive?: boolean } | null;
    if (input.branchId && !branch?.isActive) issues.push({ field: 'branchQuery', code: 'branch_inactive' });
    const lineStates = Array.isArray(state.lines)
      ? state.lines as Array<{ item?: { id?: string; isActive?: boolean; unit?: string; branchId?: string | null } | null; branch?: { isActive?: boolean } | null }>
      : [];
    input.lines?.forEach((line, index) => {
      const lineState = lineStates[index];
      if (line.inventoryItemId && (!lineState?.item?.id || !lineState.item.isActive)) {
        issues.push({ field: `lines.${index}.inventoryItemQuery`, code: 'inventory_item_missing' });
      }
      if (line.inventoryItemId && lineState?.item?.unit !== line.unit) {
        issues.push({ field: `lines.${index}.unit`, code: 'inventory_unit_mismatch' });
      }
      if (line.branchId && !lineState?.branch?.isActive) {
        issues.push({ field: `lines.${index}.branchQuery`, code: 'branch_inactive' });
      }
      if (line.inventoryItemId && line.branchId && lineState?.item?.branchId && lineState.item.branchId !== line.branchId) {
        issues.push({ field: `lines.${index}.branchQuery`, code: 'inventory_branch_mismatch' });
      }
    });
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
    if (input.supplierId && (!supplier?.isActive || supplier.type !== 'SUPPLIER')) issues.push({ field: 'supplierQuery', code: 'supplier_invalid' });
    const newSupplier = state.newSupplier as {
      matches?: unknown[];
      branch?: { isActive?: boolean } | null;
      settlementAccount?: Parameters<typeof invalidAccount>[0];
    } | undefined;
    if ((newSupplier?.matches?.length ?? 0) > 1) issues.push({ field: 'supplierQuery', code: 'party_match_ambiguous' });
    if (input.newSupplier?.branchId && !newSupplier?.branch?.isActive) issues.push({ field: 'supplierQuery', code: 'branch_inactive' });
    if (input.newSupplier?.defaultSettlementAccountId && invalidAccount(newSupplier?.settlementAccount)) {
      issues.push({ field: 'supplierQuery', code: 'account_invalid' });
    }
    if (input.paidMode === 'PAID' || input.paidMode === 'PARTIAL') {
      const code = invalidAccount(state.account as Parameters<typeof invalidAccount>[0]);
      if (code) issues.push({ field: 'accountQuery', code });
      if (!input.paymentDate) issues.push({ field: 'paymentDate', code: 'payment_date_required' });
    }
    const totalAmount = input.totalAmount ?? input.lines?.reduce(
      (sum, line) => sum + Math.max(0, line.quantity * line.unitCost - line.discount + line.extra),
      0,
    ) ?? 0;
    if (input.paidMode === 'PARTIAL' && (!input.paidAmount || input.paidAmount >= totalAmount)) {
      issues.push({ field: 'paidAmount', code: 'partial_payment_invalid' });
    }
    if ((input.paidMode === 'CREDIT' || input.paidMode === 'PARTIAL') && !input.dueDate) {
      issues.push({ field: 'dueDate', code: 'due_date_required' });
    }
    const branch = state.branch as { isActive?: boolean } | null;
    if (input.branchId && !branch?.isActive) issues.push({ field: 'branchQuery', code: 'branch_inactive' });
    const lineStates = Array.isArray(state.lines)
      ? state.lines as Array<{ item?: { id?: string; isActive?: boolean; unit?: string; branchId?: string | null } | null; branch?: { isActive?: boolean } | null }>
      : [];
    input.lines?.forEach((line, index) => {
      const lineState = lineStates[index];
      if (line.inventoryItemId && (!lineState?.item?.id || !lineState.item.isActive)) {
        issues.push({ field: `lines.${index}.inventoryItemQuery`, code: 'inventory_item_missing' });
      }
      if (line.inventoryItemId && lineState?.item?.unit !== line.unit) {
        issues.push({ field: `lines.${index}.unit`, code: 'inventory_unit_mismatch' });
      }
      if (line.branchId && !lineState?.branch?.isActive) {
        issues.push({ field: `lines.${index}.branchQuery`, code: 'branch_inactive' });
      }
      if (line.inventoryItemId && line.branchId && lineState?.item?.branchId && lineState.item.branchId !== line.branchId) {
        issues.push({ field: `lines.${index}.branchQuery`, code: 'inventory_branch_mismatch' });
      }
    });
    return issues;
  }
  if (type === 'CREATE_TRANSFER') {
    const input = ResolvedTransferActionSchema.parse(raw);
    const fromCode = invalidAccount(state.fromAccount as Parameters<typeof invalidAccount>[0]);
    const toCode = invalidAccount(state.toAccount as Parameters<typeof invalidAccount>[0]);
    if (fromCode) issues.push({ field: 'fromAccountQuery', code: fromCode });
    if (toCode) issues.push({ field: 'toAccountQuery', code: toCode });
    if (input.fromAccountId === input.toAccountId) {
      issues.push({ field: 'toAccountQuery', code: 'transfer_same_account' });
    }
    return issues;
  }
  if (type === 'UPDATE_CUSTOMER') {
    const input = ResolvedCustomerUpdateActionSchema.parse(raw);
    const customer = state.customer as { id?: string; isActive?: boolean; nameEn?: string | null; nameAr?: string | null } | null;
    if (!customer?.id || !customer.isActive) issues.push({ field: 'customerQuery', code: 'customer_inactive' });
    const samePhone = Array.isArray(state.samePhone)
      ? state.samePhone as Array<{ id: string; nameEn: string | null; nameAr: string | null }>
      : [];
    const proposedNames = {
      nameEn: input.nameEn === undefined ? customer?.nameEn ?? undefined : input.nameEn ?? undefined,
      nameAr: input.nameAr === undefined ? customer?.nameAr ?? undefined : input.nameAr ?? undefined,
    };
    if (compatibleCustomerMatches(proposedNames, samePhone).length) {
      issues.push({ field: 'phone', code: 'customer_duplicate' });
    }
    return issues;
  }
  if (type === 'UPDATE_PARTY') {
    const input = ResolvedPartyUpdateActionSchema.parse(raw);
    const party = state.party as { id?: string; isActive?: boolean } | null;
    if (!party?.id || !party.isActive) issues.push({ field: 'partyQuery', code: 'party_inactive' });
    const branch = state.branch as { isActive?: boolean } | null;
    if (input.branchId && !branch?.isActive) issues.push({ field: 'branchId', code: 'branch_inactive' });
    if (input.defaultSettlementAccountId) {
      const code = invalidAccount(state.settlementAccount as Parameters<typeof invalidAccount>[0]);
      if (code) issues.push({ field: 'defaultSettlementAccountId', code });
    }
    return issues;
  }
  if (type === 'ADJUST_INVENTORY') {
    const input = ResolvedInventoryAdjustmentActionSchema.parse(raw);
    const item = state.item as { id?: string; isActive?: boolean } | null;
    if (!item?.id || !item.isActive) issues.push({ field: 'inventoryItemQuery', code: 'inventory_item_missing' });
    if (state.currentQuantity === input.targetQuantity) issues.push({ field: 'targetQuantity', code: 'no_change' });
    return issues;
  }
  if (type === 'CREATE_ROAST_BATCH') {
    const input = ResolvedRoastBatchActionSchema.parse(raw);
    if (state.existing) issues.push({ field: 'batchNumber', code: 'batch_exists' });
    const green = state.green as { isActive?: boolean; category?: string; unit?: string } | null;
    const roasted = state.roasted as { isActive?: boolean; category?: string } | null;
    if (input.greenInventoryItemId && (!green?.isActive || green.category !== 'GREEN_COFFEE')) {
      issues.push({ field: 'greenInventoryItemQuery', code: 'green_inventory_invalid' });
    }
    if (input.roastedInventoryItemId && (!roasted?.isActive || roasted.category !== 'ROASTED')) {
      issues.push({ field: 'roastedInventoryItemQuery', code: 'roasted_inventory_invalid' });
    }
    if (green?.unit && typeof state.greenAvailable === 'number') {
      const required = green.unit.toLowerCase() === 'kg' ? input.greenInputGrams / 1000 : input.greenInputGrams;
      if (state.greenAvailable < required) issues.push({ field: 'greenInputGrams', code: 'stock_insufficient' });
    }
    const branch = state.branch as { isActive?: boolean } | null;
    if (input.branchId && !branch?.isActive) issues.push({ field: 'branchQuery', code: 'branch_inactive' });
    return issues;
  }
  if (type === 'RECORD_PAYMENT') {
    const input = ResolvedPaymentActionSchema.parse(raw);
    const account = state.account as { isActive?: boolean; currency?: string; type?: string } | null;
    const accountCode = invalidAccount(account);
    if (accountCode) issues.push({ field: 'accountQuery', code: accountCode });
    if (input.targetType === 'ORDER') {
      const order = state.order as { id?: string; currency?: string } | null;
      const payment = state.payment as { remaining?: number } | null;
      if (!order?.id) issues.push({ field: 'targetQuery', code: 'order_missing' });
      if (order?.currency && account?.currency !== order.currency) issues.push({ field: 'accountQuery', code: 'account_currency' });
      const amount = toMinor(input.amount, (order?.currency ?? 'IQD') as 'IQD' | 'USD');
      if (!payment?.remaining || amount > payment.remaining) issues.push({ field: 'amount', code: 'payment_amount_invalid' });
    } else {
      const obligation = state.obligation as { id?: string; obligation?: boolean; obligationKind?: string | null; currency?: string; archivedAt?: Date | null; reversedAt?: Date | null; reversalOfId?: string | null } | null;
      if (!obligation?.id || !obligation.obligation || !obligation.obligationKind || obligation.archivedAt || obligation.reversedAt || obligation.reversalOfId) {
        issues.push({ field: 'targetQuery', code: 'obligation_not_found' });
      }
      if (obligation?.currency && account?.currency !== obligation.currency) issues.push({ field: 'accountQuery', code: 'account_currency' });
      const amount = toMinor(input.amount, (obligation?.currency ?? 'IQD') as 'IQD' | 'USD');
      if (typeof state.outstanding !== 'number' || state.outstanding <= 0 || amount > state.outstanding) {
        issues.push({ field: 'amount', code: 'payment_amount_invalid' });
      }
    }
    return issues;
  }
  if (type === 'RECORD_REFUND') {
    const input = ResolvedRefundActionSchema.parse(raw);
    const order = state.order as { id?: string; currency?: string } | null;
    const account = state.account as { isActive?: boolean; currency?: string; type?: string } | null;
    if (!order?.id) issues.push({ field: 'orderQuery', code: 'order_missing' });
    const accountCode = invalidAccount(account);
    if (accountCode) issues.push({ field: 'accountQuery', code: accountCode });
    if (order?.currency && account?.currency !== order.currency) issues.push({ field: 'accountQuery', code: 'account_currency' });
    const amount = toMinor(input.amount, (order?.currency ?? 'IQD') as 'IQD' | 'USD');
    if (typeof state.refundable !== 'number' || state.refundable <= 0 || amount > state.refundable) {
      issues.push({ field: 'amount', code: 'refund_amount_invalid' });
    }
    return issues;
  }
  if (type === 'REVERSE_RECORD') {
    const entry = state.entry as { id?: string; importKey?: string | null; reversedAt?: Date | null; reversalOfId?: string | null; archivedAt?: Date | null; settlements?: unknown[] } | null;
    if (!entry?.id || entry.importKey || entry.reversedAt || entry.reversalOfId || entry.archivedAt) {
      issues.push({ field: 'recordQuery', code: 'entry_not_reversible' });
    }
    if (entry?.settlements?.length) issues.push({ field: 'recordQuery', code: 'entry_has_settlements' });
    return issues;
  }
  if (type === 'RECLASSIFY_SPEND') {
    const input = ResolvedSpendReclassificationActionSchema.parse(raw);
    const line = state.line as { id?: string; spendTreatment?: string } | null;
    if (!line?.id) issues.push({ field: 'lineQuery', code: 'ledger_line_missing' });
    if (line?.spendTreatment === input.spendTreatment) issues.push({ field: 'spendTreatment', code: 'no_change' });
    if (input.spendTreatment === 'CAPEX' && input.fixedAssetId && !(state.asset as { isActive?: boolean } | null)?.isActive) {
      issues.push({ field: 'fixedAssetQuery', code: 'asset_invalid' });
    }
    if (input.spendTreatment === 'INVENTORY' && !(state.item as { isActive?: boolean } | null)?.isActive) {
      issues.push({ field: 'inventoryItemQuery', code: 'inventory_item_missing' });
    }
    return issues;
  }
  if (type === 'CREATE_DASHBOARD_DRAFT') return issues;
  if (type !== 'UPDATE_ORDER_STATUS') return [{ field: 'action', code: 'action_not_supported' }];
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
    issues.push(...productIssues(products, order.lines ?? [], true).filter(
      (issue) => issue.code !== 'stock_not_configured',
    ));
  }
  return issues;
}
