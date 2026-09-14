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
import { SELLABLE_INVENTORY_CATEGORIES } from '@/server/inventory-v2/finished-goods-contracts';
import { getLocationAvailability, getLotBalances } from '@/server/inventory-v2/availability';
import {
  localExpenseAccountMatchesLocation,
  localExpenseRequiresReview,
} from '@/server/inventory-v2/local-expense-policy';
import { getReturnedLotBalances } from '@/server/inventory-v2/returns';
import { stockDocumentReversalBlockCode } from '@/server/inventory-v2/reversals';
import {
  ACTION_DATA_SCHEMAS,
  ResolvedCustomerActionSchema,
  ResolvedCustomerUpdateActionSchema,
  ResolvedDashboardDraftActionSchema,
  ResolvedDispatchStockTransferActionSchema,
  ResolvedDisposeReturnedGoodsActionSchema,
  ResolvedExpenseActionSchema,
  ResolvedInventoryAdjustmentActionSchema,
  ResolvedLocalExpenseActionSchema,
  ResolvedOrderActionSchema,
  ResolvedOrderStatusActionSchema,
  ResolvedPartyActionSchema,
  ResolvedPartyUpdateActionSchema,
  ResolvedPaymentActionSchema,
  ResolvedPurchaseActionSchema,
  ResolvedReceiveStockTransferActionSchema,
  ResolvedReturnToQuarantineActionSchema,
  ResolvedReverseStockDocumentActionSchema,
  ResolvedRefundActionSchema,
  ResolvedReversalActionSchema,
  ResolvedRoastBatchActionSchema,
  ResolvedPackingActionSchema,
  ResolvedStockReceiptActionSchema,
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

async function lockById(tx: Prisma.TransactionClient, table: 'Product' | 'Customer' | 'FinanceAccount' | 'FinanceEntry' | 'LedgerEntryLine' | 'Party' | 'Branch' | 'InventoryItem' | 'StockLocation' | 'StockDocument' | 'AiAttachment' | 'User' | 'Order' | 'OrderLine', id: string) {
  if (table === 'Product') await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'Customer') await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'FinanceAccount') await tx.$queryRaw`SELECT "id" FROM "FinanceAccount" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'FinanceEntry') await tx.$queryRaw`SELECT "id" FROM "FinanceEntry" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'LedgerEntryLine') await tx.$queryRaw`SELECT "id" FROM "LedgerEntryLine" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'Party') await tx.$queryRaw`SELECT "id" FROM "Party" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'Branch') await tx.$queryRaw`SELECT "id" FROM "Branch" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'InventoryItem') await tx.$queryRaw`SELECT "id" FROM "InventoryItem" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'StockLocation') await tx.$queryRaw`SELECT "id" FROM "StockLocation" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'StockDocument') await tx.$queryRaw`SELECT "id" FROM "StockDocument" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'AiAttachment') await tx.$queryRaw`SELECT "id" FROM "AiAttachment" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'User') await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'Order') await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`;
  if (table === 'OrderLine') await tx.$queryRaw`SELECT "id" FROM "OrderLine" WHERE "id" = ${id} FOR UPDATE`;
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
    if (input.fulfillmentLocationId) await lockById(tx, 'StockLocation', input.fulfillmentLocationId);
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
    if (input.locationId) await lockById(tx, 'StockLocation', input.locationId);
    await lockById(tx, 'InventoryItem', input.inventoryItemId);
    return;
  }
  if (type === 'RECEIVE_STOCK') {
    const input = ResolvedStockReceiptActionSchema.parse(raw);
    await lockById(tx, 'StockLocation', input.locationId);
    await lockById(tx, 'InventoryItem', input.inventoryItemId);
    if (input.partyId) await lockById(tx, 'Party', input.partyId);
    if (input.newSupplier) await lockNewParty(tx, input.newSupplier);
    if (input.accountId) await lockById(tx, 'FinanceAccount', input.accountId);
    return;
  }
  if (type === 'PACK_FINISHED_GOODS') {
    const input = ResolvedPackingActionSchema.parse(raw);
    await lockById(tx, 'StockLocation', input.locationId);
    await lockById(tx, 'Product', input.productId);
    await lockById(tx, 'InventoryItem', input.outputInventoryItemId);
    await tx.$queryRaw`SELECT "id" FROM "ProductRecipeVersion" WHERE "id" = ${input.recipeVersionId} FOR UPDATE`;
    const components = await tx.productRecipeComponent.findMany({
      where: { recipeVersionId: input.recipeVersionId, inventoryItemId: { not: null } },
      select: { inventoryItemId: true },
      orderBy: { inventoryItemId: 'asc' },
    });
    for (const component of components) {
      if (component.inventoryItemId) await lockById(tx, 'InventoryItem', component.inventoryItemId);
    }
    return;
  }
  if (type === 'DISPATCH_STOCK_TRANSFER') {
    const input = ResolvedDispatchStockTransferActionSchema.parse(raw);
    for (const id of [input.sourceLocationId, input.destinationLocationId, input.transitLocationId].sort()) {
      await lockById(tx, 'StockLocation', id);
    }
    for (const id of [...new Set(input.lines.map((line) => line.inventoryItemId))].sort()) {
      await lockById(tx, 'InventoryItem', id);
    }
    return;
  }
  if (type === 'RECEIVE_STOCK_TRANSFER') {
    const input = ResolvedReceiveStockTransferActionSchema.parse(raw);
    await lockById(tx, 'StockDocument', input.stockDocumentId);
    for (const id of [input.destinationLocationId, input.transitLocationId].sort()) {
      await lockById(tx, 'StockLocation', id);
    }
    for (const id of [...new Set([
      ...input.lines.map((line) => line.inventoryItemId),
      ...input.discrepancies.map((row) => row.inventoryItemId),
    ])].sort()) {
      await lockById(tx, 'InventoryItem', id);
    }
    return;
  }
  if (type === 'RECORD_LOCAL_EXPENSE') {
    const input = ResolvedLocalExpenseActionSchema.parse(raw);
    await lockById(tx, 'User', input.userId);
    await lockById(tx, 'StockLocation', input.locationId);
    await lockById(tx, 'FinanceAccount', input.financeAccountId);
    if (input.receiptAttachmentId) await lockById(tx, 'AiAttachment', input.receiptAttachmentId);
    return;
  }
  if (type === 'RETURN_TO_QUARANTINE') {
    const input = ResolvedReturnToQuarantineActionSchema.parse(raw);
    await lockById(tx, 'OrderLine', input.orderLineId);
    await lockById(tx, 'InventoryItem', input.inventoryItemId);
    for (const id of [input.fulfillmentLocationId, input.quarantineLocationId].sort()) {
      await lockById(tx, 'StockLocation', id);
    }
    return;
  }
  if (type === 'DISPOSE_RETURNED_GOODS') {
    const input = ResolvedDisposeReturnedGoodsActionSchema.parse(raw);
    await lockById(tx, 'StockDocument', input.returnDocumentId);
    await lockById(tx, 'InventoryItem', input.inventoryItemId);
    const locationIds = [input.quarantineLocationId, input.destinationLocationId]
      .filter((id): id is string => Boolean(id))
      .sort();
    for (const id of locationIds) await lockById(tx, 'StockLocation', id);
    if (input.supplierPartyId) await lockById(tx, 'Party', input.supplierPartyId);
    return;
  }
  if (type === 'REVERSE_STOCK_DOCUMENT') {
    const input = ResolvedReverseStockDocumentActionSchema.parse(raw);
    await lockById(tx, 'StockDocument', input.stockDocumentId);
    for (const row of [...input.expectedLocationVersions].sort((left, right) => left.locationId.localeCompare(right.locationId))) {
      await lockById(tx, 'StockLocation', row.locationId);
    }
    return;
  }
  if (type === 'CREATE_ROAST_BATCH') {
    const input = ResolvedRoastBatchActionSchema.parse(raw);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`roast-batch:${input.batchNumber}`}))`;
    if (input.locationId) await lockById(tx, 'StockLocation', input.locationId);
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

async function productStates(productIds: string[], db: Db, locationId?: string) {
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
        where: {
          isActive: true,
          ...(locationId ? { category: { in: [...SELLABLE_INVENTORY_CATEGORIES] } } : {}),
        },
        select: {
          id: true,
          locationPolicies: {
            where: locationId
              ? { locationId, isActive: true, canSell: true }
              : { id: { in: [] } },
            select: { id: true },
            take: 1,
          },
          movements: {
            where: {
              ...(locationId ? { locationId } : {}),
              OR: [
                { financeEntryId: null },
                { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } },
              ],
            },
            select: { quantity: true },
          },
          reservations: {
            where: locationId
              ? {
                  locationId,
                  status: 'ACTIVE',
                  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                }
              : { id: { in: [] } },
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
    availableQuantity: product.inventoryItems.reduce((total, item) => {
      if (locationId && !item.locationPolicies.length) return total;
      const onHand = item.movements.reduce((sum, movement) => sum + decimalNumber(movement.quantity), 0);
      const reserved = item.reservations.reduce((sum, reservation) => sum + decimalNumber(reservation.quantity), 0);
      return total + Math.max(0, onHand - reserved);
    }, 0),
    inventoryItems: product.inventoryItems.map((item) => item.id),
    locationConfigured: locationId
      ? product.inventoryItems.length === 1 && product.inventoryItems[0].locationPolicies.length === 1
      : true,
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
  const [products, customer, account, provider, status, channel, governorate, fulfillment, location] = await Promise.all([
    productStates(input.lines.map((line) => line.productId), db, input.fulfillmentLocationId),
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
          select: { id: true, currency: true, type: true, isActive: true, stockLocationId: true },
        })
      : Promise.resolve(null),
    providerState(db, input.financeProviderId),
    managedListState(db, 'orderStatus', input.status, ORDER_STATUSES),
    managedListState(db, 'channel', input.channel, CHANNELS),
    managedListState(db, 'governorate', input.governorate, GOVERNORATES),
    managedListState(db, 'fulfillment', input.fulfillmentMethod, FULFILLMENT_METHODS),
    input.fulfillmentLocationId
      ? db.stockLocation.findUnique({
          where: { id: input.fulfillmentLocationId },
          select: { id: true, isActive: true, stockVersion: true },
        })
      : Promise.resolve(null),
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
    location,
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
  const [item, location] = await Promise.all([
    db.inventoryItem.findUnique({
      where: { id: input.inventoryItemId },
      select: {
        id: true,
        nameEn: true,
        nameAr: true,
        unit: true,
        isActive: true,
        movements: {
          where: {
            ...(input.locationId ? { locationId: input.locationId } : {}),
            OR: [
              { financeEntryId: null },
              { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } },
            ],
          },
          select: { quantity: true },
        },
        locationPolicies: {
          where: input.locationId
            ? { locationId: input.locationId }
            : { id: { in: [] } },
          select: { isActive: true },
          take: 1,
        },
      },
    }),
    input.locationId
      ? db.stockLocation.findUnique({
          where: { id: input.locationId },
          select: { id: true, isActive: true, stockVersion: true },
        })
      : Promise.resolve(null),
  ]);
  const currentQuantity = item?.movements.reduce(
    (sum, movement) => sum + decimalNumber(movement.quantity),
    0,
  ) ?? null;
  return {
    item: item ? {
      id: item.id,
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      unit: item.unit,
      isActive: item.isActive,
    } : null,
    currentQuantity,
    location,
    locationPolicy: item?.locationPolicies[0] ?? null,
  };
}

async function stockReceiptPreconditions(raw: unknown, db: Db) {
  const input = ResolvedStockReceiptActionSchema.parse(raw);
  const [item, location, party, newSupplier, account] = await Promise.all([
    db.inventoryItem.findUnique({
      where: { id: input.inventoryItemId },
      select: {
        id: true,
        isActive: true,
        unit: true,
        locationPolicies: {
          where: { locationId: input.locationId },
          select: { isActive: true },
          take: 1,
        },
      },
    }),
    db.stockLocation.findUnique({
      where: { id: input.locationId },
      select: { id: true, isActive: true, stockVersion: true, branchId: true },
    }),
    input.partyId
      ? db.party.findUnique({
          where: { id: input.partyId },
          select: { id: true, isActive: true, type: true, name: true },
        })
      : Promise.resolve(null),
    newPartyPreconditions(input.newSupplier, db),
    input.accountId
      ? db.financeAccount.findUnique({
          where: { id: input.accountId },
          select: {
            id: true,
            isActive: true,
            currency: true,
            type: true,
            branchId: true,
            stockLocationId: true,
          },
        })
      : Promise.resolve(null),
  ]);
  return {
    item: item ? { id: item.id, isActive: item.isActive, unit: item.unit } : null,
    locationPolicy: item?.locationPolicies[0] ?? null,
    location,
    party,
    newSupplier,
    account,
  };
}

async function packingPreconditions(raw: unknown, db: Db) {
  const input = ResolvedPackingActionSchema.parse(raw);
  const [location, outputItem, recipe] = await Promise.all([
    db.stockLocation.findUnique({
      where: { id: input.locationId },
      select: { id: true, isActive: true, stockVersion: true },
    }),
    db.inventoryItem.findUnique({
      where: { id: input.outputInventoryItemId },
      select: {
        id: true,
        isActive: true,
        category: true,
        unit: true,
        productId: true,
        locationPolicies: {
          where: { locationId: input.locationId },
          select: { isActive: true, canSell: true },
          take: 1,
        },
      },
    }),
    db.productRecipeVersion.findUnique({
      where: { id: input.recipeVersionId },
      select: {
        id: true,
        productId: true,
        version: true,
        isActive: true,
        components: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            inventoryItemId: true,
            name: true,
            quantity: true,
            inventoryItem: {
              select: {
                id: true,
                isActive: true,
                locationPolicies: {
                  where: { locationId: input.locationId },
                  select: { isActive: true, canProduce: true },
                  take: 1,
                },
                movements: {
                  where: {
                    locationId: input.locationId,
                    OR: [
                      { financeEntryId: null },
                      { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } },
                    ],
                  },
                  select: { quantity: true },
                },
                reservations: {
                  where: {
                    locationId: input.locationId,
                    status: 'ACTIVE',
                    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                  },
                  select: { quantity: true },
                },
              },
            },
          },
        },
      },
    }),
  ]);
  const productionQuantity = input.outputQuantity + input.rejectedQuantity;
  return {
    location,
    outputItem: outputItem ? {
      id: outputItem.id,
      isActive: outputItem.isActive,
      category: outputItem.category,
      unit: outputItem.unit,
      productId: outputItem.productId,
      locationPolicy: outputItem.locationPolicies[0] ?? null,
    } : null,
    recipe: recipe ? {
      id: recipe.id,
      productId: recipe.productId,
      version: recipe.version,
      isActive: recipe.isActive,
      components: recipe.components.map((component) => {
        const onHand = component.inventoryItem?.movements.reduce(
          (sum, movement) => sum + decimalNumber(movement.quantity),
          0,
        ) ?? 0;
        const reserved = component.inventoryItem?.reservations.reduce(
          (sum, reservation) => sum + decimalNumber(reservation.quantity),
          0,
        ) ?? 0;
        return {
          id: component.id,
          name: component.name,
          inventoryItemId: component.inventoryItemId,
          required: decimalNumber(component.quantity) * productionQuantity,
          available: Math.max(0, onHand - reserved),
          inventoryItemActive: component.inventoryItem?.isActive ?? false,
          locationPolicy: component.inventoryItem?.locationPolicies[0] ?? null,
        };
      }),
    } : null,
  };
}

async function dispatchStockTransferPreconditions(raw: unknown, db: Db) {
  const input = ResolvedDispatchStockTransferActionSchema.parse(raw);
  const itemIds = [...new Set(input.lines.map((line) => line.inventoryItemId))];
  const [source, destination, transit, items] = await Promise.all([
    db.stockLocation.findUnique({
      where: { id: input.sourceLocationId },
      select: { id: true, branchId: true, type: true, isActive: true, isSystem: true, stockVersion: true },
    }),
    db.stockLocation.findUnique({
      where: { id: input.destinationLocationId },
      select: { id: true, branchId: true, type: true, isActive: true, isSystem: true },
    }),
    db.stockLocation.findUnique({
      where: { id: input.transitLocationId },
      select: { id: true, branchId: true, type: true, isActive: true, isSystem: true, stockVersion: true },
    }),
    db.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true,
        isActive: true,
        unit: true,
        locationPolicies: {
          where: { locationId: { in: [input.sourceLocationId, input.destinationLocationId] } },
          select: { locationId: true, isActive: true },
        },
        movements: {
          where: {
            locationId: input.sourceLocationId,
            OR: [
              { financeEntryId: null },
              { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } },
            ],
          },
          select: { quantity: true },
        },
        reservations: {
          where: {
            locationId: input.sourceLocationId,
            status: 'ACTIVE',
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          select: { quantity: true },
        },
      },
    }),
  ]);
  const byId = new Map(items.map((item) => [item.id, item]));
  return {
    source,
    destination,
    transit,
    lines: input.lines.map((line) => {
      const item = byId.get(line.inventoryItemId);
      const onHand = item?.movements.reduce((sum, movement) => sum + decimalNumber(movement.quantity), 0) ?? 0;
      const reserved = item?.reservations.reduce((sum, reservation) => sum + decimalNumber(reservation.quantity), 0) ?? 0;
      return {
        item: item ? { id: item.id, isActive: item.isActive, unit: item.unit } : null,
        sourcePolicy: item?.locationPolicies.find((policy) => policy.locationId === input.sourceLocationId) ?? null,
        destinationPolicy: item?.locationPolicies.find((policy) => policy.locationId === input.destinationLocationId) ?? null,
        available: Math.max(0, onHand - reserved),
      };
    }),
  };
}

async function receiveStockTransferPreconditions(raw: unknown, db: Db) {
  const input = ResolvedReceiveStockTransferActionSchema.parse(raw);
  const itemIds = [...new Set([
    ...input.lines.map((line) => line.inventoryItemId),
    ...input.discrepancies.map((row) => row.inventoryItemId),
  ])];
  const [document, destination, transit, items, childDocuments] = await Promise.all([
    db.stockDocument.findUnique({
      where: { id: input.stockDocumentId },
      select: {
        id: true,
        documentNumber: true,
        type: true,
        status: true,
        version: true,
        destinationLocationId: true,
      },
    }),
    db.stockLocation.findUnique({
      where: { id: input.destinationLocationId },
      select: { id: true, branchId: true, isActive: true, isSystem: true, stockVersion: true },
    }),
    db.stockLocation.findUnique({
      where: { id: input.transitLocationId },
      select: { id: true, branchId: true, type: true, isActive: true, isSystem: true, stockVersion: true },
    }),
    db.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true,
        isActive: true,
        unit: true,
        locationPolicies: {
          where: { locationId: input.destinationLocationId },
          select: { isActive: true },
          take: 1,
        },
      },
    }),
    db.stockDocument.findMany({
      where: { parentDocumentId: input.stockDocumentId },
      select: { id: true },
    }),
  ]);
  const documentIds = [input.stockDocumentId, ...childDocuments.map((row) => row.id)];
  const balances = await db.stockMovement.groupBy({
    by: ['inventoryItemId'],
    where: {
      stockDocumentId: { in: documentIds },
      locationId: input.transitLocationId,
    },
    _sum: { quantity: true },
  });
  const outstanding = new Map(balances.map((row) => [
    row.inventoryItemId,
    Math.max(0, decimalNumber(row._sum.quantity)),
  ]));
  const byId = new Map(items.map((item) => [item.id, item]));
  return {
    document,
    destination,
    transit,
    outstanding: Object.fromEntries(outstanding),
    items: itemIds.map((inventoryItemId) => {
      const item = byId.get(inventoryItemId);
      return {
        inventoryItemId,
        item: item ? { id: item.id, isActive: item.isActive, unit: item.unit } : null,
        destinationPolicy: item?.locationPolicies[0] ?? null,
      };
    }),
  };
}

async function localExpensePreconditions(raw: unknown, db: Db) {
  const input = ResolvedLocalExpenseActionSchema.parse(raw);
  const [user, location, account, policy, attachment] = await Promise.all([
    db.user.findUnique({
      where: { id: input.userId },
      select: { id: true, isActive: true, defaultFinanceAccountId: true },
    }),
    db.stockLocation.findUnique({
      where: { id: input.locationId },
      select: { id: true, branchId: true, isActive: true, isSystem: true, stockVersion: true },
    }),
    db.financeAccount.findUnique({
      where: { id: input.financeAccountId },
      select: {
        id: true,
        name: true,
        isActive: true,
        currency: true,
        type: true,
        branchId: true,
        stockLocationId: true,
      },
    }),
    db.locationExpensePolicy.findUnique({
      where: { locationId: input.locationId },
      select: {
        isActive: true,
        allowedCategories: true,
        maxImmediateAmount: true,
        receiptRequiredAbove: true,
      },
    }),
    input.receiptAttachmentId
      ? db.aiAttachment.findUnique({
          where: { id: input.receiptAttachmentId },
          select: {
            id: true,
            userId: true,
            kind: true,
            status: true,
            fileName: true,
            expiresAt: true,
          },
        })
      : Promise.resolve(null),
  ]);
  return { user, location, account, policy, attachment };
}

async function returnToQuarantinePreconditions(raw: unknown, db: Db) {
  const input = ResolvedReturnToQuarantineActionSchema.parse(raw);
  const orderLine = await db.orderLine.findUnique({
    where: { id: input.orderLineId },
    select: {
      id: true,
      orderId: true,
      sku: true,
      product: { select: { nameEn: true, nameAr: true } },
      order: {
        select: {
          orderNumber: true,
          fulfillmentLocationId: true,
        },
      },
      stockMovements: {
        where: { reason: { in: ['SOLD', 'QUARANTINE'] }, costLayerId: { not: null } },
        select: {
          reason: true,
          quantity: true,
          inventoryItem: { select: { id: true, nameEn: true, nameAr: true, unit: true, isActive: true } },
        },
      },
    },
  });
  const fulfillmentLocationId = orderLine?.order.fulfillmentLocationId ?? input.fulfillmentLocationId;
  const fulfillment = await db.stockLocation.findUnique({
    where: { id: fulfillmentLocationId },
    select: { id: true, branchId: true, isActive: true, isSystem: true, stockVersion: true },
  });
  const quarantine = fulfillment
    ? await db.stockLocation.findFirst({
        where: { branchId: fulfillment.branchId, type: 'QUARANTINE', isActive: true, isSystem: true },
        select: { id: true, branchId: true, isActive: true, isSystem: true, stockVersion: true },
      })
    : null;
  const soldMovements = orderLine?.stockMovements.filter((movement) => movement.reason === 'SOLD') ?? [];
  const returnedMovements = orderLine?.stockMovements.filter((movement) => movement.reason === 'QUARANTINE') ?? [];
  const inventoryItemIds = [...new Set(soldMovements.map((movement) => movement.inventoryItem.id))];
  const soldQuantity = soldMovements.reduce(
    (sum, movement) => sum + Math.abs(Math.min(0, decimalNumber(movement.quantity))),
    0,
  );
  const returnedQuantity = returnedMovements.reduce(
    (sum, movement) => sum + Math.max(0, decimalNumber(movement.quantity)),
    0,
  );
  return {
    orderLine,
    fulfillment,
    quarantine,
    inventoryItemIds,
    soldQuantity,
    returnedQuantity,
    returnableQuantity: Number(Math.max(0, soldQuantity - returnedQuantity).toFixed(3)),
  };
}

async function disposeReturnedGoodsPreconditions(raw: unknown, db: Db) {
  const input = ResolvedDisposeReturnedGoodsActionSchema.parse(raw);
  let returned: Awaited<ReturnType<typeof getReturnedLotBalances>> | null = null;
  try {
    returned = await getReturnedLotBalances(db, input.returnDocumentId);
  } catch {
    returned = null;
  }
  const [item, quarantine, destination, supplier, variancePolicy] = await Promise.all([
    db.inventoryItem.findUnique({
      where: { id: input.inventoryItemId },
      select: { id: true, nameEn: true, nameAr: true, unit: true, isActive: true },
    }),
    db.stockLocation.findUnique({
      where: { id: input.quarantineLocationId },
      select: { id: true, branchId: true, type: true, isActive: true, isSystem: true, stockVersion: true },
    }),
    input.destinationLocationId
      ? db.stockLocation.findUnique({
          where: { id: input.destinationLocationId },
          select: {
            id: true,
            branchId: true,
            type: true,
            isActive: true,
            isSystem: true,
            stockVersion: true,
            policies: {
              where: { inventoryItemId: input.inventoryItemId },
              select: { isActive: true, canSell: true, canProduce: true },
              take: 1,
            },
          },
        })
      : Promise.resolve(null),
    input.supplierPartyId
      ? db.party.findUnique({
          where: { id: input.supplierPartyId },
          select: { id: true, name: true, type: true, isActive: true },
        })
      : Promise.resolve(null),
    returned?.document.sourceLocationId
      ? db.inventoryVariancePolicy.findUnique({
          where: { locationId: returned.document.sourceLocationId },
          select: {
            isActive: true,
            inventoryLossAccountCode: true,
            inventoryGainAccountCode: true,
          },
        })
      : Promise.resolve(null),
  ]);
  const availableQuantity = returned?.lots
    .filter((lot) => lot.inventoryItemId === input.inventoryItemId)
    .reduce((sum, lot) => sum + lot.quantity, 0) ?? 0;
  return {
    returned,
    item,
    quarantine,
    destination,
    supplier,
    variancePolicy,
    availableQuantity: Number(availableQuantity.toFixed(3)),
  };
}

async function reverseStockDocumentPreconditions(raw: unknown, db: Db) {
  const input = ResolvedReverseStockDocumentActionSchema.parse(raw);
  const document = await db.stockDocument.findUnique({
    where: { id: input.stockDocumentId },
    include: {
      parentDocument: { select: { type: true } },
      childDocuments: { select: { type: true, status: true } },
      movements: {
        select: {
          inventoryItemId: true,
          locationId: true,
          costLayerId: true,
          quantity: true,
          financeEntryId: true,
        },
      },
      costLayers: { select: { financeEntryId: true } },
      discrepancies: { select: { id: true } },
      discrepancyResolutions: { select: { id: true } },
      inventoryCount: { select: { id: true } },
      reversedByDocument: { select: { id: true } },
    },
  });
  if (!document) return { document: null, locations: [], outputReversible: false, financeReversible: false };

  const locationIds = [...new Set(document.movements.flatMap((movement) => (
    movement.locationId ? [movement.locationId] : []
  )))];
  const locations = await db.stockLocation.findMany({
    where: { id: { in: locationIds } },
    select: { id: true, nameEn: true, nameAr: true, isActive: true, stockVersion: true },
  });

  let outputReversible = true;
  const positiveByItemLocation = new Map<string, number>();
  for (const movement of document.movements) {
    const quantity = decimalNumber(movement.quantity);
    if (quantity <= 0) continue;
    if (!movement.locationId || !movement.costLayerId) {
      outputReversible = false;
      continue;
    }
    const lots = await getLotBalances(db, movement.inventoryItemId, movement.locationId);
    const balance = lots.find((lot) => lot.id === movement.costLayerId)?.quantity ?? 0;
    if (balance + 0.0005 < quantity) outputReversible = false;
    const key = `${movement.inventoryItemId}:${movement.locationId}`;
    positiveByItemLocation.set(key, Number(((positiveByItemLocation.get(key) ?? 0) + quantity).toFixed(3)));
  }
  for (const [key, quantity] of positiveByItemLocation) {
    const [inventoryItemId, locationId] = key.split(':');
    const availability = await getLocationAvailability(db, inventoryItemId, locationId);
    if (availability.available + 0.0005 < quantity) outputReversible = false;
  }

  const financeEntryIds = [...new Set([
    ...document.movements.flatMap((movement) => movement.financeEntryId ? [movement.financeEntryId] : []),
    ...document.costLayers.flatMap((layer) => layer.financeEntryId ? [layer.financeEntryId] : []),
  ])];
  const financeEntries = await db.financeEntry.findMany({
    where: { id: { in: financeEntryIds } },
    include: {
      settlements: {
        where: { archivedAt: null, reversedAt: null, reversalOfId: null },
        select: { id: true },
      },
      stockMovements: { select: { stockDocumentId: true } },
      costLayers: { select: { stockDocumentId: true } },
      fixedAssets: { select: { id: true } },
    },
  });
  const financeReversible = financeEntries.length === financeEntryIds.length && financeEntries.every((entry) => (
    !entry.archivedAt
    && !entry.reversedAt
    && !entry.reversalOfId
    && !entry.settlesId
    && !entry.settlements.length
    && !entry.providerSettlementId
    && !entry.fixedAssets.length
    && !entry.inventoryCountId
    && entry.stockMovements.every((movement) => movement.stockDocumentId === document.id)
    && entry.costLayers.every((layer) => layer.stockDocumentId === document.id)
  ));

  return { document, locations, outputReversible, financeReversible };
}

async function roastBatchPreconditions(raw: unknown, db: Db) {
  const input = ResolvedRoastBatchActionSchema.parse(raw);
  const [existing, green, roasted, branch, location] = await Promise.all([
    db.roastBatch.findUnique({ where: { batchNumber: input.batchNumber }, select: { id: true } }),
    input.greenInventoryItemId
      ? db.inventoryItem.findUnique({
          where: { id: input.greenInventoryItemId },
          select: {
            id: true,
            category: true,
            unit: true,
            isActive: true,
            movements: {
              where: {
                ...(input.locationId ? { locationId: input.locationId } : {}),
                OR: [
                  { financeEntryId: null },
                  { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } },
                ],
              },
              select: { quantity: true },
            },
            locationPolicies: {
              where: input.locationId
                ? { locationId: input.locationId }
                : { id: { in: [] } },
              select: { isActive: true, canProduce: true },
              take: 1,
            },
          },
        })
      : Promise.resolve(null),
    input.roastedInventoryItemId
      ? db.inventoryItem.findUnique({
          where: { id: input.roastedInventoryItemId },
          select: {
            id: true,
            category: true,
            unit: true,
            isActive: true,
            locationPolicies: {
              where: input.locationId
                ? { locationId: input.locationId }
                : { id: { in: [] } },
              select: { isActive: true, canProduce: true },
              take: 1,
            },
          },
        })
      : Promise.resolve(null),
    input.branchId && !input.locationId
      ? db.branch.findUnique({ where: { id: input.branchId }, select: { id: true, isActive: true } })
      : Promise.resolve(null),
    input.locationId
      ? db.stockLocation.findUnique({
          where: { id: input.locationId },
          select: { id: true, isActive: true, stockVersion: true, branchId: true },
        })
      : Promise.resolve(null),
  ]);
  const greenAvailable = green?.movements.reduce(
    (sum, movement) => sum + decimalNumber(movement.quantity),
    0,
  ) ?? null;
  return {
    existing,
    green: green ? {
      id: green.id,
      category: green.category,
      unit: green.unit,
      isActive: green.isActive,
    } : null,
    greenAvailable,
    roasted: roasted ? {
      id: roasted.id,
      category: roasted.category,
      unit: roasted.unit,
      isActive: roasted.isActive,
    } : null,
    greenLocationPolicy: green?.locationPolicies[0] ?? null,
    roastedLocationPolicy: roasted?.locationPolicies[0] ?? null,
    branch,
    location,
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
    case 'RECEIVE_STOCK':
      return stockReceiptPreconditions(raw, db);
    case 'PACK_FINISHED_GOODS':
      return packingPreconditions(raw, db);
    case 'DISPATCH_STOCK_TRANSFER':
      return dispatchStockTransferPreconditions(raw, db);
    case 'RECEIVE_STOCK_TRANSFER':
      return receiveStockTransferPreconditions(raw, db);
    case 'RECORD_LOCAL_EXPENSE':
      return localExpensePreconditions(raw, db);
    case 'RETURN_TO_QUARANTINE':
      return returnToQuarantinePreconditions(raw, db);
    case 'DISPOSE_RETURNED_GOODS':
      return disposeReturnedGoodsPreconditions(raw, db);
    case 'REVERSE_STOCK_DOCUMENT':
      return reverseStockDocumentPreconditions(raw, db);
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
    locationConfigured?: boolean;
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
    if (requireStock && product.trackInventory && product.locationConfigured === false) {
      issues.push({ field: 'lines', code: 'stock_location_not_sellable', detail: product.sku });
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
    const needsInventoryConfiguration = status?.role === 'SALE'
      || Boolean(input.fulfillmentLocationId && status?.role === 'OPEN');
    const stockIssues = productIssues(products, input.lines, needsInventoryConfiguration);
    issues.push(...(input.fulfillmentLocationId
      ? stockIssues.filter((issue) => issue.code !== 'stock_insufficient')
      : stockIssues.filter((issue) => issue.code !== 'stock_not_configured')));
    if (input.fulfillmentLocationId) {
      const location = state.location as { id?: string; isActive?: boolean; stockVersion?: number } | null;
      if (!location?.id || !location.isActive) {
        issues.push({ field: 'locationQuery', code: 'location_invalid' });
      }
      if (location?.stockVersion !== input.expectedLocationVersion) {
        issues.push({ field: 'locationQuery', code: 'location_stale' });
      }
      const account = state.account as { stockLocationId?: string | null } | null;
      if (
        input.financeAccountId &&
        account?.stockLocationId !== input.fulfillmentLocationId
      ) {
        issues.push({ field: 'financeAccountQuery', code: 'account_location_mismatch' });
      }
    }
    if (!(state.channel as ManagedListState | undefined)?.active) issues.push({ field: 'channel', code: 'channel_invalid' });
    if (!(state.governorate as ManagedListState | undefined)?.active) issues.push({ field: 'governorate', code: 'governorate_invalid' });
    if (!(state.fulfillment as ManagedListState | undefined)?.active) issues.push({ field: 'fulfillmentMethod', code: 'fulfillment_invalid' });
    if (!status?.active || status.role === 'UNKNOWN') issues.push({ field: 'status', code: 'status_invalid' });
    const customer = state.customer as {
      id: string;
      isActive: boolean;
      nameEn: string | null;
      nameAr: string | null;
    } | null;
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
    if (input.locationId) {
      const location = state.location as { id?: string; isActive?: boolean; stockVersion?: number } | null;
      const policy = state.locationPolicy as { isActive?: boolean } | null;
      if (!location?.id || !location.isActive) issues.push({ field: 'locationQuery', code: 'location_invalid' });
      if (location?.stockVersion !== input.expectedLocationVersion) {
        issues.push({ field: 'locationQuery', code: 'location_stale' });
      }
      if (!policy?.isActive) {
        issues.push({ field: 'inventoryItemQuery', code: 'inventory_location_not_configured' });
      }
    }
    if (state.currentQuantity === input.targetQuantity) issues.push({ field: 'targetQuantity', code: 'no_change' });
    return issues;
  }
  if (type === 'RECEIVE_STOCK') {
    const input = ResolvedStockReceiptActionSchema.parse(raw);
    const item = state.item as { id?: string; isActive?: boolean; unit?: string } | null;
    const location = state.location as { id?: string; isActive?: boolean; stockVersion?: number; branchId?: string } | null;
    const policy = state.locationPolicy as { isActive?: boolean } | null;
    if (!item?.id || !item.isActive) issues.push({ field: 'inventoryItemQuery', code: 'inventory_item_missing' });
    if (item?.unit && item.unit !== input.inventoryUnit) issues.push({ field: 'inventoryItemQuery', code: 'inventory_unit_changed' });
    if (!location?.id || !location.isActive) issues.push({ field: 'locationQuery', code: 'location_invalid' });
    if (location?.stockVersion !== input.expectedLocationVersion) issues.push({ field: 'locationQuery', code: 'location_stale' });
    if (!policy?.isActive) issues.push({ field: 'inventoryItemQuery', code: 'inventory_location_not_configured' });
    const party = state.party as { id?: string; isActive?: boolean; type?: string } | null;
    if (input.partyId && (!party?.id || !party.isActive || !['SUPPLIER', 'OTHER'].includes(party.type ?? ''))) {
      issues.push({ field: 'supplierQuery', code: 'supplier_invalid' });
    }
    const newSupplier = state.newSupplier as { matches?: unknown[] } | undefined;
    if ((newSupplier?.matches?.length ?? 0) > 1) issues.push({ field: 'supplierQuery', code: 'party_match_ambiguous' });
    if (input.paymentMode === 'PAID') {
      const account = state.account as {
        isActive?: boolean;
        currency?: string;
        type?: string;
        branchId?: string | null;
        stockLocationId?: string | null;
      } | null;
      const accountCode = invalidAccount(account);
      if (accountCode) issues.push({ field: 'accountQuery', code: accountCode });
      if (
        account
        && ((account.stockLocationId && account.stockLocationId !== input.locationId)
          || (!account.stockLocationId && account.branchId && account.branchId !== location?.branchId))
      ) {
        issues.push({ field: 'accountQuery', code: 'account_location_mismatch' });
      }
    }
    if (input.bestBefore && new Date(input.bestBefore) < new Date(input.occurredAt)) {
      issues.push({ field: 'bestBefore', code: 'best_before_invalid' });
    }
    return issues;
  }
  if (type === 'PACK_FINISHED_GOODS') {
    const input = ResolvedPackingActionSchema.parse(raw);
    const location = state.location as { id?: string; isActive?: boolean; stockVersion?: number } | null;
    const output = state.outputItem as {
      id?: string;
      isActive?: boolean;
      category?: string;
      unit?: string;
      productId?: string | null;
      locationPolicy?: { isActive?: boolean; canSell?: boolean } | null;
    } | null;
    const recipe = state.recipe as {
      id?: string;
      productId?: string;
      version?: number;
      isActive?: boolean;
      components?: Array<{
        name: string;
        inventoryItemId: string | null;
        required: number;
        available: number;
        inventoryItemActive: boolean;
        locationPolicy: { isActive?: boolean; canProduce?: boolean } | null;
      }>;
    } | null;
    if (!location?.id || !location.isActive) issues.push({ field: 'locationQuery', code: 'location_invalid' });
    if (location?.stockVersion !== input.expectedLocationVersion) issues.push({ field: 'locationQuery', code: 'location_stale' });
    if (!output?.id || !output.isActive || output.productId !== input.productId) {
      issues.push({ field: 'outputInventoryItemQuery', code: 'packing_output_invalid' });
    }
    if (output?.unit && output.unit !== input.outputUnit) {
      issues.push({ field: 'outputInventoryItemQuery', code: 'inventory_unit_changed' });
    }
    if (!output?.category || !['FINISHED_GOOD', 'DRIP_BAGS', 'ACCESSORY'].includes(output.category)) {
      issues.push({ field: 'outputInventoryItemQuery', code: 'packing_output_not_finished_good' });
    }
    if (!output?.locationPolicy?.isActive || !output.locationPolicy.canSell) {
      issues.push({ field: 'outputInventoryItemQuery', code: 'packing_output_not_sellable' });
    }
    if (
      !recipe?.id
      || !recipe.isActive
      || recipe.productId !== input.productId
      || recipe.version !== input.recipeVersion
    ) {
      issues.push({ field: 'outputInventoryItemQuery', code: 'packing_recipe_stale' });
    }
    if (!recipe?.components?.length) issues.push({ field: 'outputInventoryItemQuery', code: 'packing_recipe_empty' });
    for (const component of recipe?.components ?? []) {
      if (!component.inventoryItemId) continue;
      if (!component.inventoryItemActive || !component.locationPolicy?.isActive || !component.locationPolicy.canProduce) {
        issues.push({ field: 'outputInventoryItemQuery', code: 'packing_component_not_producible', detail: component.name });
      } else if (component.available < component.required) {
        issues.push({
          field: 'outputQuantity',
          code: 'stock_insufficient',
          detail: `${component.name}:${component.available}:${component.required}`,
        });
      }
    }
    if (input.bestBefore && new Date(input.bestBefore) < new Date(input.packedAt)) {
      issues.push({ field: 'bestBefore', code: 'best_before_invalid' });
    }
    return issues;
  }
  if (type === 'DISPATCH_STOCK_TRANSFER') {
    const input = ResolvedDispatchStockTransferActionSchema.parse(raw);
    const source = state.source as {
      id?: string;
      isActive?: boolean;
      isSystem?: boolean;
      stockVersion?: number;
    } | null;
    const destination = state.destination as {
      id?: string;
      branchId?: string;
      isActive?: boolean;
      isSystem?: boolean;
    } | null;
    const transit = state.transit as {
      id?: string;
      branchId?: string;
      type?: string;
      isActive?: boolean;
      isSystem?: boolean;
      stockVersion?: number;
    } | null;
    if (!source?.id || !source.isActive || source.isSystem) {
      issues.push({ field: 'sourceLocationQuery', code: 'transfer_source_invalid' });
    }
    if (source?.stockVersion !== input.expectedSourceVersion) {
      issues.push({ field: 'sourceLocationQuery', code: 'location_stale' });
    }
    if (!destination?.id || !destination.isActive || destination.isSystem) {
      issues.push({ field: 'destinationLocationQuery', code: 'transfer_destination_invalid' });
    }
    if (
      !transit?.id
      || !transit.isActive
      || !transit.isSystem
      || transit.type !== 'IN_TRANSIT'
      || transit.branchId !== destination?.branchId
    ) {
      issues.push({ field: 'destinationLocationQuery', code: 'transit_location_invalid' });
    }
    if (transit?.stockVersion !== input.expectedTransitVersion) {
      issues.push({ field: 'destinationLocationQuery', code: 'location_stale' });
    }
    const lineStates = Array.isArray(state.lines) ? state.lines as Array<{
      item?: { id?: string; isActive?: boolean; unit?: string } | null;
      sourcePolicy?: { isActive?: boolean } | null;
      destinationPolicy?: { isActive?: boolean } | null;
      available?: number;
    }> : [];
    input.lines.forEach((line, index) => {
      const current = lineStates[index];
      if (!current?.item?.id || !current.item.isActive) {
        issues.push({ field: `lines.${index}.inventoryItemQuery`, code: 'inventory_item_missing' });
      } else if (current.item.unit !== line.unit) {
        issues.push({ field: `lines.${index}.inventoryItemQuery`, code: 'inventory_unit_changed' });
      }
      if (!current?.sourcePolicy?.isActive) {
        issues.push({ field: `lines.${index}.inventoryItemQuery`, code: 'transfer_source_item_not_configured' });
      }
      if (!current?.destinationPolicy?.isActive) {
        issues.push({ field: `lines.${index}.inventoryItemQuery`, code: 'transfer_destination_item_not_configured' });
      }
      if ((current?.available ?? 0) + 0.0005 < line.quantity) {
        issues.push({
          field: `lines.${index}.quantity`,
          code: 'stock_insufficient',
          detail: `${line.inventoryItemName}:${current?.available ?? 0}:${line.quantity}`,
        });
      }
    });
    return issues;
  }
  if (type === 'RECEIVE_STOCK_TRANSFER') {
    const input = ResolvedReceiveStockTransferActionSchema.parse(raw);
    const document = state.document as {
      id?: string;
      documentNumber?: string;
      type?: string;
      status?: string;
      version?: number;
      destinationLocationId?: string | null;
    } | null;
    const destination = state.destination as {
      id?: string;
      branchId?: string;
      isActive?: boolean;
      isSystem?: boolean;
      stockVersion?: number;
    } | null;
    const transit = state.transit as {
      id?: string;
      branchId?: string;
      type?: string;
      isActive?: boolean;
      isSystem?: boolean;
      stockVersion?: number;
    } | null;
    if (
      !document?.id
      || document.type !== 'TRANSFER'
      || document.documentNumber !== input.transferNumber
      || document.destinationLocationId !== input.destinationLocationId
    ) {
      issues.push({ field: 'transferQuery', code: 'transfer_not_found' });
    } else if (!['DISPATCHED', 'PARTIALLY_RECEIVED'].includes(document.status ?? '')) {
      issues.push({ field: 'transferQuery', code: 'transfer_not_receivable' });
    }
    if (document?.version !== input.expectedDocumentVersion) {
      issues.push({ field: 'transferQuery', code: 'document_stale' });
    }
    if (!destination?.id || !destination.isActive || destination.isSystem) {
      issues.push({ field: 'transferQuery', code: 'transfer_destination_invalid' });
    }
    if (destination?.stockVersion !== input.expectedDestinationVersion) {
      issues.push({ field: 'transferQuery', code: 'location_stale' });
    }
    if (
      !transit?.id
      || !transit.isActive
      || !transit.isSystem
      || transit.type !== 'IN_TRANSIT'
      || transit.branchId !== destination?.branchId
      || transit.id !== input.transitLocationId
    ) {
      issues.push({ field: 'transferQuery', code: 'transit_location_invalid' });
    }
    if (transit?.stockVersion !== input.expectedTransitVersion) {
      issues.push({ field: 'transferQuery', code: 'location_stale' });
    }
    const itemStates = Array.isArray(state.items) ? state.items as Array<{
      inventoryItemId: string;
      item?: { id?: string; isActive?: boolean; unit?: string } | null;
      destinationPolicy?: { isActive?: boolean } | null;
    }> : [];
    const itemById = new Map(itemStates.map((row) => [row.inventoryItemId, row]));
    const outstanding = (state.outstanding ?? {}) as Record<string, number>;
    const received = new Map(input.lines.map((line) => [line.inventoryItemId, line.quantity]));
    const validateItem = (inventoryItemId: string, unit: string, field: string) => {
      const current = itemById.get(inventoryItemId);
      if (!current?.item?.id || !current.item.isActive) {
        issues.push({ field, code: 'inventory_item_missing' });
      } else if (current.item.unit !== unit) {
        issues.push({ field, code: 'inventory_unit_changed' });
      }
      if (!current?.destinationPolicy?.isActive) {
        issues.push({ field, code: 'transfer_destination_item_not_configured' });
      }
    };
    input.lines.forEach((line, index) => {
      validateItem(line.inventoryItemId, line.unit, `lines.${index}.inventoryItemQuery`);
      if (!outstanding[line.inventoryItemId] || line.quantity - outstanding[line.inventoryItemId] > 0.0005) {
        issues.push({ field: `lines.${index}.quantity`, code: 'transfer_receipt_exceeds_dispatch' });
      }
    });
    input.discrepancies.forEach((row, index) => {
      validateItem(row.inventoryItemId, row.unit, `discrepancies.${index}.inventoryItemQuery`);
      const available = outstanding[row.inventoryItemId];
      if (!available) {
        issues.push({ field: `discrepancies.${index}.inventoryItemQuery`, code: 'transfer_discrepancy_item_invalid' });
      } else if (
        row.type !== 'EXCESS'
        && (received.get(row.inventoryItemId) ?? 0) + row.quantity - available > 0.0005
      ) {
        issues.push({ field: `discrepancies.${index}.quantity`, code: 'transfer_discrepancy_exceeds_outstanding' });
      }
    });
    return issues;
  }
  if (type === 'RECORD_LOCAL_EXPENSE') {
    const input = ResolvedLocalExpenseActionSchema.parse(raw);
    const user = state.user as {
      id?: string;
      isActive?: boolean;
      defaultFinanceAccountId?: string | null;
    } | null;
    const location = state.location as {
      id?: string;
      branchId?: string;
      isActive?: boolean;
      isSystem?: boolean;
      stockVersion?: number;
    } | null;
    const account = state.account as {
      id?: string;
      name?: string;
      isActive: boolean;
      currency: string;
      type: string;
      branchId: string | null;
      stockLocationId: string | null;
    } | null;
    const policy = state.policy as {
      isActive: boolean;
      allowedCategories: string[];
      maxImmediateAmount: number;
      receiptRequiredAbove: number;
    } | null;
    if (!user?.id || !user.isActive || user.id !== input.userId) {
      issues.push({ field: 'action', code: 'user_inactive' });
    }
    if (user?.defaultFinanceAccountId !== input.financeAccountId) {
      issues.push({ field: 'account', code: 'expense_default_account_changed' });
    }
    if (!location?.id || !location.isActive || location.isSystem) {
      issues.push({ field: 'locationQuery', code: 'location_invalid' });
    }
    if (location?.stockVersion !== input.expectedLocationVersion) {
      issues.push({ field: 'locationQuery', code: 'location_stale' });
    }
    if (
      !account?.id
      || account.name !== input.financeAccountName
      || !location?.id
      || !location.branchId
      || !localExpenseAccountMatchesLocation(account, { id: location.id, branchId: location.branchId })
    ) {
      issues.push({ field: 'account', code: 'expense_default_account_invalid' });
    }
    const requiresReview = localExpenseRequiresReview(policy, {
      amount: input.amount,
      categoryType: input.categoryType,
      hasReceipt: Boolean(input.receiptAttachmentId),
    });
    if (requiresReview !== input.willRequireReview) {
      issues.push({ field: 'categoryType', code: 'expense_policy_changed' });
    }
    if (input.receiptAttachmentId) {
      const attachment = state.attachment as {
        id?: string;
        userId?: string;
        kind?: string;
        status?: string;
        fileName?: string;
        expiresAt?: Date;
      } | null;
      if (
        attachment?.id !== input.receiptAttachmentId
        || attachment.userId !== input.userId
        || !['RECEIPT_IMAGE', 'DOCUMENT'].includes(attachment.kind ?? '')
        || attachment.status !== 'READY'
        || attachment.fileName !== input.receiptFileName
        || !attachment.expiresAt
        || attachment.expiresAt <= new Date()
      ) {
        issues.push({ field: 'receipt', code: 'expense_receipt_invalid' });
      }
    }
    return issues;
  }
  if (type === 'RETURN_TO_QUARANTINE') {
    const input = ResolvedReturnToQuarantineActionSchema.parse(raw);
    const orderLine = state.orderLine as {
      id?: string;
      orderId?: string;
      sku?: string;
      order?: { orderNumber?: string; fulfillmentLocationId?: string | null };
    } | null;
    const fulfillment = state.fulfillment as {
      id?: string;
      branchId?: string;
      isActive?: boolean;
      isSystem?: boolean;
      stockVersion?: number;
    } | null;
    const quarantine = state.quarantine as {
      id?: string;
      branchId?: string;
      isActive?: boolean;
      isSystem?: boolean;
      stockVersion?: number;
    } | null;
    const inventoryItemIds = Array.isArray(state.inventoryItemIds)
      ? state.inventoryItemIds as string[]
      : [];
    if (
      orderLine?.id !== input.orderLineId
      || orderLine.orderId !== input.orderId
      || orderLine.order?.orderNumber !== input.orderNumber
      || orderLine.order?.fulfillmentLocationId !== input.fulfillmentLocationId
      || orderLine.sku !== input.sku
    ) {
      issues.push({ field: 'orderQuery', code: 'return_order_line_invalid' });
    }
    if (inventoryItemIds.length !== 1 || inventoryItemIds[0] !== input.inventoryItemId) {
      issues.push({ field: 'productQuery', code: 'return_inventory_link_ambiguous' });
    }
    if (!fulfillment?.id || !fulfillment.isActive || fulfillment.isSystem || fulfillment.id !== input.fulfillmentLocationId) {
      issues.push({ field: 'orderQuery', code: 'return_fulfillment_invalid' });
    } else if (fulfillment.stockVersion !== input.expectedFulfillmentVersion) {
      issues.push({ field: 'orderQuery', code: 'location_stale' });
    }
    if (
      !quarantine?.id
      || !quarantine.isActive
      || !quarantine.isSystem
      || quarantine.id !== input.quarantineLocationId
      || quarantine.branchId !== fulfillment?.branchId
    ) {
      issues.push({ field: 'orderQuery', code: 'return_quarantine_invalid' });
    } else if (quarantine.stockVersion !== input.expectedQuarantineVersion) {
      issues.push({ field: 'orderQuery', code: 'location_stale' });
    }
    const returnableQuantity = Number(state.returnableQuantity ?? 0);
    if (input.quantity - returnableQuantity > 0.0005) {
      issues.push({
        field: 'quantity',
        code: 'return_exceeds_sold_quantity',
        detail: `${returnableQuantity}:${input.quantity}`,
      });
    }
    return issues;
  }
  if (type === 'DISPOSE_RETURNED_GOODS') {
    const input = ResolvedDisposeReturnedGoodsActionSchema.parse(raw);
    const returned = state.returned as {
      document?: {
        id?: string;
        documentNumber?: string;
        version?: number;
        destinationLocationId?: string;
        branchId?: string;
      };
    } | null;
    const item = state.item as {
      id?: string;
      nameEn?: string;
      nameAr?: string;
      unit?: string;
      isActive?: boolean;
    } | null;
    const quarantine = state.quarantine as {
      id?: string;
      branchId?: string;
      type?: string;
      isActive?: boolean;
      isSystem?: boolean;
      stockVersion?: number;
    } | null;
    const destination = state.destination as {
      id?: string;
      branchId?: string;
      type?: string;
      isActive?: boolean;
      isSystem?: boolean;
      stockVersion?: number;
      policies?: Array<{ isActive?: boolean; canSell?: boolean; canProduce?: boolean }>;
    } | null;
    const supplier = state.supplier as { id?: string; name?: string; type?: string; isActive?: boolean } | null;
    const returnDocument = returned?.document;
    if (
      returnDocument?.id !== input.returnDocumentId
      || returnDocument.documentNumber !== input.returnDocumentNumber
      || returnDocument.destinationLocationId !== input.quarantineLocationId
    ) {
      issues.push({ field: 'returnQuery', code: 'return_document_invalid' });
    } else if (returnDocument.version !== input.expectedReturnDocumentVersion) {
      issues.push({ field: 'returnQuery', code: 'document_stale' });
    }
    if (
      item?.id !== input.inventoryItemId
      || !item.isActive
      || item.unit !== input.unit
      || ![item.nameEn, item.nameAr].includes(input.inventoryItemName)
    ) {
      issues.push({ field: 'inventoryItemQuery', code: 'inventory_item_missing' });
    }
    if (
      quarantine?.id !== input.quarantineLocationId
      || !quarantine.isActive
      || !quarantine.isSystem
      || quarantine.type !== 'QUARANTINE'
      || quarantine.branchId !== returnDocument?.branchId
    ) {
      issues.push({ field: 'returnQuery', code: 'return_quarantine_invalid' });
    } else if (quarantine.stockVersion !== input.expectedQuarantineVersion) {
      issues.push({ field: 'returnQuery', code: 'location_stale' });
    }
    const availableQuantity = Number(state.availableQuantity ?? 0);
    if (input.quantity - availableQuantity > 0.0005) {
      issues.push({
        field: 'quantity',
        code: 'return_disposition_exceeds_quarantine',
        detail: `${availableQuantity}:${input.quantity}`,
      });
    }
    if (input.destinationLocationId) {
      const policy = destination?.policies?.[0];
      const correctType = input.disposition !== 'REPACK' || destination?.type === 'PACKING';
      const correctPolicy = input.disposition === 'RESTOCK' ? policy?.canSell : policy?.canProduce;
      if (
        destination?.id !== input.destinationLocationId
        || !destination.isActive
        || destination.isSystem
        || destination.branchId !== quarantine?.branchId
        || !correctType
        || !policy?.isActive
        || !correctPolicy
      ) {
        issues.push({ field: 'destinationLocationQuery', code: 'return_destination_invalid' });
      } else if (destination.stockVersion !== input.expectedDestinationVersion) {
        issues.push({ field: 'destinationLocationQuery', code: 'location_stale' });
      }
    }
    if (input.supplierPartyId && (
      supplier?.id !== input.supplierPartyId
      || supplier.name !== input.supplierName
      || supplier.type !== 'SUPPLIER'
      || !supplier.isActive
    )) {
      issues.push({ field: 'supplierQuery', code: 'return_supplier_invalid' });
    }
    if (input.disposition === 'WASTE') {
      const variancePolicy = state.variancePolicy as {
        isActive?: boolean;
        inventoryLossAccountCode?: string | null;
      } | null;
      if (!variancePolicy?.isActive || !variancePolicy.inventoryLossAccountCode) {
        issues.push({ field: 'disposition', code: 'return_waste_policy_invalid' });
      }
    }
    return issues;
  }
  if (type === 'REVERSE_STOCK_DOCUMENT') {
    const input = ResolvedReverseStockDocumentActionSchema.parse(raw);
    const document = state.document as {
      id?: string;
      documentNumber?: string;
      type?: Parameters<typeof stockDocumentReversalBlockCode>[0]['type'];
      status?: Parameters<typeof stockDocumentReversalBlockCode>[0]['status'];
      version?: number;
      parentDocument?: { type?: Parameters<typeof stockDocumentReversalBlockCode>[0]['parentType'] } | null;
      childDocuments?: Array<{ type?: string; status?: string }>;
      discrepancies?: unknown[];
      discrepancyResolutions?: unknown[];
      inventoryCount?: unknown;
      reversedByDocument?: unknown;
    } | null;
    if (
      document?.id !== input.stockDocumentId
      || document.documentNumber !== input.documentNumber
      || document.type !== input.documentType
    ) {
      issues.push({ field: 'documentQuery', code: 'stock_document_invalid' });
      return issues;
    }
    if (document.version !== input.expectedDocumentVersion) {
      issues.push({ field: 'documentQuery', code: 'document_stale' });
    }
    const blockCode = stockDocumentReversalBlockCode({
      type: document.type,
      status: document.status!,
      parentType: document.parentDocument?.type ?? null,
      activeChildCount: document.childDocuments?.filter((child) => child.type !== 'REVERSAL' && child.status !== 'REVERSED').length ?? 0,
      discrepancyCount: document.discrepancies?.length ?? 0,
      discrepancyResolutionCount: document.discrepancyResolutions?.length ?? 0,
      hasInventoryCount: Boolean(document.inventoryCount),
    });
    if (blockCode || document.reversedByDocument) {
      issues.push({ field: 'documentQuery', code: blockCode ?? 'stock_document_already_reversed' });
    }
    const locations = Array.isArray(state.locations)
      ? state.locations as Array<{ id: string; isActive: boolean; stockVersion: number }>
      : [];
    const currentById = new Map(locations.map((location) => [location.id, location]));
    if (
      currentById.size !== input.expectedLocationVersions.length
      || input.expectedLocationVersions.some((row) => !currentById.has(row.locationId))
    ) {
      issues.push({ field: 'documentQuery', code: 'location_version_coverage_mismatch' });
    }
    for (const expected of input.expectedLocationVersions) {
      const location = currentById.get(expected.locationId);
      if (!location?.isActive) {
        issues.push({ field: 'documentQuery', code: 'location_invalid' });
      } else if (location.stockVersion !== expected.stockVersion) {
        issues.push({ field: 'documentQuery', code: 'location_stale' });
      }
    }
    if (!state.outputReversible) {
      issues.push({ field: 'documentQuery', code: 'stock_document_output_consumed' });
    }
    if (!state.financeReversible) {
      issues.push({ field: 'documentQuery', code: 'stock_finance_not_reversible' });
    }
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
    if (input.locationId) {
      const location = state.location as { id?: string; isActive?: boolean; stockVersion?: number; branchId?: string } | null;
      const greenPolicy = state.greenLocationPolicy as { isActive?: boolean; canProduce?: boolean } | null;
      const roastedPolicy = state.roastedLocationPolicy as { isActive?: boolean; canProduce?: boolean } | null;
      if (!location?.id || !location.isActive) issues.push({ field: 'locationQuery', code: 'location_invalid' });
      if (location?.stockVersion !== input.expectedLocationVersion) {
        issues.push({ field: 'locationQuery', code: 'location_stale' });
      }
      if (!greenPolicy?.isActive || !greenPolicy.canProduce) {
        issues.push({ field: 'greenInventoryItemQuery', code: 'inventory_not_producible_here' });
      }
      if (!roastedPolicy?.isActive || !roastedPolicy.canProduce) {
        issues.push({ field: 'roastedInventoryItemQuery', code: 'inventory_not_producible_here' });
      }
      if (input.branchId && location?.branchId && input.branchId !== location.branchId) {
        issues.push({ field: 'locationQuery', code: 'location_branch_mismatch' });
      }
      if (input.roastedOutputGrams === null) {
        issues.push({ field: 'roastedOutputGrams', code: 'roasted_output_required' });
      }
    }
    if (green?.unit && typeof state.greenAvailable === 'number') {
      const required = green.unit.toLowerCase() === 'kg' ? input.greenInputGrams / 1000 : input.greenInputGrams;
      if (state.greenAvailable < required) issues.push({ field: 'greenInputGrams', code: 'stock_insufficient' });
    }
    const branch = state.branch as { isActive?: boolean } | null;
    if (input.branchId && !input.locationId && !branch?.isActive) issues.push({ field: 'branchQuery', code: 'branch_inactive' });
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
