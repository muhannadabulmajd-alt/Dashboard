'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { FULFILLMENT_METHODS } from '@/lib/enums';
import { invoicePaymentSnapshot, invoiceTotal } from '@/lib/invoice';
import { toMinor } from '@/lib/money';
import { syncActiveCostForProducts } from '@/server/inventory/fifo';
import {
  closeOrderFinance,
  syncOrderCustomerBalance,
  syncOrderFinance,
  type FinanceSyncMode,
} from '@/server/finance/sync';
import { getOrderStatusRoleMap } from '@/server/lists/resolver';
import {
  applySoldMovements,
  resolveOrderInventoryReadiness,
  syncCustomerStats,
} from '@/server/orders/sync';
import { generateOrderNumber } from '@/server/records/numbering';
import {
  enrichCustomerForOrderInTransaction,
  resolveOrCreateCustomerInTransaction,
  CustomerCommandSchema,
  CustomerOrderEnrichmentSchema,
  type CustomerCommandInput,
  type CustomerOrderEnrichmentInput,
} from '@/server/commands/customers';
import type { TrustedCommandContext } from '@/server/commands/actor-context';
import {
  requireCap,
  resolveCommandActor,
  audit,
  reqField,
  optField,
  type ActionState,
  type CommandCommitHook,
  type CommandPreconditionHook,
} from './shared';

const LIST = '/[locale]/(dashboard)/admin/records/orders';
const FINANCE = '/[locale]/(dashboard)/finance';
const LEDGER = '/[locale]/(dashboard)/finance/ledger';
const DUES = '/[locale]/(dashboard)/finance/dues';
const CAP = 'manage:orders' as const;

const bulkOrderSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(100),
  operation: z.enum(['STATUS', 'RECORD_PAID', 'ASSIGN_PROVIDER']),
  status: z.string().optional(),
  completionMode: z.enum(['AUTO', 'DIRECT', 'PROVIDER']).optional(),
  accountId: z.string().optional(),
  providerKey: z.string().min(1).optional(),
  paymentMethod: z.string().optional(),
  date: z.coerce.date().optional(),
});

type LineData = {
  productId: string;
  sku: string;
  quantity: number;
  unitLabel: string;
  unitGrossPrice: number;
  lineDiscount: number;
  lineNet: number;
  unitCogsSnapshot: number;
};

type OrderCreateStage =
  | 'validation'
  | 'customer_lookup'
  | 'product_lookup'
  | 'branch_lookup'
  | 'order_number'
  | 'order_insert'
  | 'stock_sync'
  | 'finance_sync'
  | 'customer_stats'
  | 'commit_hook';

const headerSchema = z.object({
  orderNumber: z.string().optional(),
  placedAt: z.coerce.date(),
  customerExternalId: z.string().optional(),
  // channel/governorate/status are list-managed codes (§9): the dropdowns are
  // built from the managed lists, so accept any non-empty code.
  channel: z.string().min(1),
  governorate: z.string().min(1),
  fulfillmentMethod: z.enum(FULFILLMENT_METHODS),
  status: z.string().min(1),
  deliveryFee: z.coerce.number().int().nonnegative().default(0),
  deliveryCost: z.coerce.number().int().nonnegative().default(0),
  orderDiscount: z.coerce.number().int().nonnegative().default(0),
  extraCharges: z.coerce.number().int().nonnegative().default(0),
  notes: z.string().optional(),
  financeMode: z.enum(['AUTO', 'NONE', 'CREDIT', 'PAID', 'PARTIAL', 'PROVIDER', 'KEEP']).default('AUTO'),
  financeAccountId: z.string().optional(),
  financeProviderId: z.string().optional(),
  financePaidAmount: z.coerce.number().int().nonnegative().optional(),
  financePaymentMethod: z.string().optional(),
  financePaymentDate: z.coerce.date().optional(),
  financeDueDate: z.coerce.date().optional(),
});

const lineSchema = z.array(
  z.object({
    sku: z.string().min(1),
    quantity: z.coerce.number().int().positive(),
    unitGrossPrice: z.coerce.number().int().nonnegative(),
    lineDiscount: z.coerce.number().int().nonnegative().default(0),
  }),
);

const OrderCreateCommandInputSchema = headerSchema.omit({ orderNumber: true }).extend({
  locale: z.enum(['en', 'ar']).default('ar'),
  customerExternalId: z.string().nullish(),
  newCustomer: CustomerCommandSchema.nullish(),
  customerEnrichment: CustomerOrderEnrichmentSchema.nullish(),
  financeAccountId: z.string().nullish(),
  financeProviderId: z.string().nullish(),
  financePaidAmount: z.coerce.number().int().nonnegative().nullish(),
  financePaymentMethod: z.string().nullish(),
  financePaymentDate: z.coerce.date().nullish(),
  financeDueDate: z.coerce.date().nullish(),
  notes: z.string().nullish(),
  lines: lineSchema,
}).strict();

export type OrderCreateCommandInput = z.input<typeof OrderCreateCommandInputSchema>;

const BulkOrderCommandInputSchema = bulkOrderSchema.strict();
export type BulkOrderCommandInput = z.input<typeof BulkOrderCommandInputSchema>;

function setCommandField(fd: FormData, key: string, value: unknown): void {
  if (value === null || value === undefined || value === '') return;
  fd.set(key, value instanceof Date ? value.toISOString() : String(value));
}

/**
 * Typed adapter shared by web AI and Telegram. The existing FormData action
 * remains a thin UI boundary while all trusted callers validate the same
 * command contract before entering the order transaction.
 */
export async function createOrderFromInput(
  rawInput: OrderCreateCommandInput,
  options: {
    actorContext?: TrustedCommandContext;
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{ recordId: string; recordNumber: string }>;
  } = {},
): Promise<ActionState> {
  const parsed = OrderCreateCommandInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(
      parsed.error.issues.map((issue) => [issue.path.join('.') || 'form', 'invalid']),
    );
    return { error: 'invalid', formError: 'invalid', fieldErrors, stage: 'validation' };
  }
  const input = parsed.data;
  const fd = new FormData();
  setCommandField(fd, 'locale', input.locale);
  setCommandField(fd, 'placedAt', input.placedAt);
  setCommandField(fd, 'customerExternalId', input.customerExternalId);
  if (input.newCustomer) setCommandField(fd, 'newCustomer', JSON.stringify(input.newCustomer));
  if (input.customerEnrichment) setCommandField(fd, 'customerEnrichment', JSON.stringify(input.customerEnrichment));
  setCommandField(fd, 'channel', input.channel);
  setCommandField(fd, 'governorate', input.governorate);
  setCommandField(fd, 'fulfillmentMethod', input.fulfillmentMethod);
  setCommandField(fd, 'status', input.status);
  setCommandField(fd, 'deliveryFee', input.deliveryFee);
  setCommandField(fd, 'deliveryCost', input.deliveryCost);
  setCommandField(fd, 'orderDiscount', input.orderDiscount);
  setCommandField(fd, 'extraCharges', input.extraCharges);
  setCommandField(fd, 'notes', input.notes);
  setCommandField(fd, 'financeMode', input.financeMode);
  setCommandField(fd, 'financeAccountId', input.financeAccountId);
  setCommandField(fd, 'financeProviderId', input.financeProviderId);
  setCommandField(fd, 'financePaidAmount', input.financePaidAmount);
  setCommandField(fd, 'financePaymentMethod', input.financePaymentMethod);
  setCommandField(fd, 'financePaymentDate', input.financePaymentDate);
  setCommandField(fd, 'financeDueDate', input.financeDueDate);
  setCommandField(fd, 'lines', JSON.stringify(input.lines));
  return createOrderCommand(fd, options);
}

export async function bulkUpdateOrdersFromInput(
  rawInput: BulkOrderCommandInput,
  options: {
    actorContext?: TrustedCommandContext;
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{ count: number; amountApplied: number }>;
  } = {},
): Promise<ActionState> {
  const parsed = BulkOrderCommandInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      error: 'invalid',
      formError: 'invalid',
      fieldErrors: Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.') || 'form', 'invalid'])),
      stage: 'validation',
    };
  }
  const input = parsed.data;
  const fd = new FormData();
  setCommandField(fd, 'orderIds', JSON.stringify(input.orderIds));
  setCommandField(fd, 'operation', input.operation);
  setCommandField(fd, 'status', input.status);
  setCommandField(fd, 'completionMode', input.completionMode);
  setCommandField(fd, 'accountId', input.accountId);
  setCommandField(fd, 'providerKey', input.providerKey);
  setCommandField(fd, 'paymentMethod', input.paymentMethod);
  setCommandField(fd, 'date', input.date);
  return bulkUpdateOrders(undefined, fd, options);
}

function parseHeader(fd: FormData) {
  return headerSchema.safeParse({
    orderNumber: reqField(fd, 'orderNumber'),
    placedAt: reqField(fd, 'placedAt'),
    customerExternalId: optField(fd, 'customerExternalId'),
    channel: reqField(fd, 'channel'),
    governorate: reqField(fd, 'governorate'),
    fulfillmentMethod: reqField(fd, 'fulfillmentMethod'),
    status: reqField(fd, 'status'),
    deliveryFee: optField(fd, 'deliveryFee'),
    deliveryCost: optField(fd, 'deliveryCost'),
    orderDiscount: optField(fd, 'orderDiscount'),
    extraCharges: optField(fd, 'extraCharges'),
    notes: optField(fd, 'notes'),
    financeMode: optField(fd, 'financeMode') || 'AUTO',
    financeAccountId: optField(fd, 'financeAccountId'),
    financeProviderId: optField(fd, 'financeProviderId'),
    financePaidAmount: optField(fd, 'financePaidAmount'),
    financePaymentMethod: optField(fd, 'financePaymentMethod'),
    financePaymentDate: optField(fd, 'financePaymentDate'),
    financeDueDate: optField(fd, 'financeDueDate'),
  });
}

const refundFor = (isReturn: boolean, gross: number, discount: number, deliveryFee: number, extraCharges: number) =>
  isReturn
    ? Math.max(0, gross - discount + deliveryFee + extraCharges)
    : 0;

function orderActionError(error: unknown, context: Record<string, unknown>) {
  const err = error as { name?: string; code?: string; message?: string };
  console.error('[orders]', {
    ...context,
    errorName: err?.name,
    errorCode: err?.code,
    errorMessage: err?.message,
  });
}

async function persistOrderFailure(input: {
  userId: string;
  action: 'CREATE' | 'UPDATE';
  debugId: string;
  error: unknown;
  metadata: Record<string, unknown>;
}) {
  const rawCode = input.error instanceof Error ? input.error.message : 'unknown';
  const errorCode = rawCode.split(':')[0].slice(0, 120);
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: `ORDER_${input.action}_FAILED`,
      entity: 'Order',
      entityId: typeof input.metadata.orderId === 'string' ? input.metadata.orderId : null,
      metadata: {
        ...input.metadata,
        debugId: input.debugId,
        errorCode,
      } as Prisma.InputJsonObject,
    },
  }).catch((auditError) => orderActionError(auditError, {
    stage: 'failure_audit',
    debugId: input.debugId,
  }));
}

function headerActionError(result: ReturnType<typeof parseHeader>): NonNullable<ActionState> {
  if (result.success) return { error: 'invalid' };
  const paths = result.error.issues.map((issue) => issue.path.join('.'));
  if (paths.some((path) => path === 'placedAt')) return { error: 'date', fieldErrors: { placedAt: 'date' } };
  if (paths.some((path) => path === 'financePaidAmount')) return { error: 'partial', fieldErrors: { financePaidAmount: 'partial' } };
  if (paths.some((path) => path === 'financeAccountId')) return { error: 'account', fieldErrors: { financeAccountId: 'account' } };
  const fieldErrors = Object.fromEntries(paths.filter(Boolean).map((path) => [path, 'invalid']));
  return { error: 'invalid', fieldErrors };
}

function lineActionError(result: ReturnType<typeof lineSchema.safeParse>): NonNullable<ActionState> {
  if (result.success) return { error: 'invalid' };
  const paths = result.error.issues.map((issue) => issue.path.join('.'));
  if (paths.some((path) => path.endsWith('.sku'))) return { error: 'sku', fieldErrors: { lines: 'sku' } };
  if (paths.some((path) => path.endsWith('.quantity'))) return { error: 'quantity', fieldErrors: { lines: 'quantity' } };
  if (paths.some((path) => path.endsWith('.unitGrossPrice') || path.endsWith('.lineDiscount'))) {
    return { error: 'price', fieldErrors: { lines: 'price' } };
  }
  return { error: 'nolines', fieldErrors: { lines: 'nolines' } };
}

function createOrderFailure(stage: OrderCreateStage, error: unknown, context: Record<string, unknown>): NonNullable<ActionState> {
  const debugId = `order-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  orderActionError(error, { ...context, stage, debugId });
  if (stage === 'order_number' || stage === 'order_insert') {
    return { error: 'order_create_failed', formError: 'order_create_failed', stage, debugId };
  }
  if (stage === 'stock_sync') {
    return { error: 'stock_sync_failed', formError: 'stock_sync_failed', fieldErrors: { lines: 'stock_sync_failed' }, stage, debugId };
  }
  if (stage === 'finance_sync') {
    return { error: 'finance_sync_failed', formError: 'finance_sync_failed', fieldErrors: { financeMode: 'finance_sync_failed' }, stage, debugId };
  }
  if (stage === 'customer_stats') {
    return { error: 'customer_stats_failed', formError: 'customer_stats_failed', fieldErrors: { customerExternalId: 'customer_stats_failed' }, stage, debugId };
  }
  if (stage === 'commit_hook') {
    return { error: 'commit_failed', formError: 'commit_failed', stage, debugId };
  }
  return { error: 'create_failed', formError: 'create_failed', stage, debugId };
}

async function resolveAutomaticOrderFinance(input: {
  channel: string;
  fulfillmentMethod: (typeof FULFILLMENT_METHODS)[number];
  statusRole: string;
}, client: typeof prisma | Prisma.TransactionClient = prisma) {
  const providerKey =
    input.channel === 'ONLINE_STORE'
      ? 'WAYL'
      : input.statusRole === 'SALE' && input.fulfillmentMethod === 'COURIER'
        ? 'HI_EXPRESS'
        : null;
  if (providerKey) {
    const provider = await client.party.findUnique({
      where: { externalKey: providerKey },
      select: {
        id: true,
        isActive: true,
        collectsOrderPayments: true,
        defaultSettlementAccountId: true,
      },
    });
    if (
      !provider?.isActive ||
      !provider.collectsOrderPayments ||
      !provider.defaultSettlementAccountId
    ) {
      throw new Error('provider_configuration');
    }
    return {
      mode: 'PROVIDER' as FinanceSyncMode,
      accountId: provider.defaultSettlementAccountId,
      providerId: provider.id,
      paymentMethod: providerKey === 'WAYL' ? 'ONLINE_PAYMENT' : 'COURIER_COLLECTION',
    };
  }
  if (input.statusRole !== 'SALE') {
    return {
      mode: 'NONE' as FinanceSyncMode,
      accountId: null,
      providerId: null,
      paymentMethod: null,
    };
  }

  const cashAccount = await client.financeAccount.findUnique({
    where: { externalKey: 'CASH_ON_HANDS' },
    select: { id: true, isActive: true },
  });
  if (!cashAccount?.isActive) throw new Error('cash_account');
  return {
    mode: 'PAID' as FinanceSyncMode,
    accountId: cashAccount.id,
    providerId: null,
    paymentMethod: 'CASH',
  };
}

async function resolveDirectPaymentAccount(
  requestedId: string | null | undefined,
  client: Pick<Prisma.TransactionClient, 'financeAccount'> = prisma,
) {
  const account = requestedId
    ? await client.financeAccount.findFirst({
        where: { id: requestedId, isActive: true, currency: 'IQD', type: { not: 'PAYMENT_GATEWAY' } },
        select: { id: true },
      })
    : await client.financeAccount.findFirst({
        where: { externalKey: 'CASH_ON_HANDS', isActive: true, currency: 'IQD' },
        select: { id: true },
      });
  if (!account) throw new Error('payment_account_invalid');
  return account.id;
}

export async function createOrderCommand(
  fd: FormData,
  options: {
    actorContext?: TrustedCommandContext;
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{ recordId: string; recordNumber: string }>;
  } = {},
): Promise<ActionState> {
  const user = await resolveCommandActor(CAP, options.actorContext);
  if (!user) return { error: 'forbidden' };
  const h = parseHeader(fd);
  if (!h.success) return headerActionError(h);

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(reqField(fd, 'lines') || '[]');
  } catch {
    return { error: 'nolines', fieldErrors: { lines: 'nolines' } };
  }
  const parsedLines = lineSchema.safeParse(rawLines);
  if (!parsedLines.success) return lineActionError(parsedLines);
  if (parsedLines.data.length === 0) return { error: 'nolines', fieldErrors: { lines: 'nolines' } };

  if (h.data.orderNumber && await prisma.order.findUnique({ where: { orderNumber: h.data.orderNumber }, select: { id: true } }))
    return { error: 'exists', fieldErrors: { orderNumber: 'exists' } };
  if (h.data.financeMode === 'KEEP') {
    return { error: 'invalid', fieldErrors: { financeMode: 'invalid' } };
  }
  let newCustomer: CustomerCommandInput | null = null;
  const newCustomerRaw = optField(fd, 'newCustomer');
  if (newCustomerRaw) {
    try {
      const parsedCustomer = CustomerCommandSchema.safeParse(JSON.parse(newCustomerRaw));
      if (!parsedCustomer.success) {
        return { error: 'customer', fieldErrors: { customerExternalId: 'customer' } };
      }
      newCustomer = parsedCustomer.data;
    } catch {
      return { error: 'customer', fieldErrors: { customerExternalId: 'customer' } };
    }
  }
  if (h.data.customerExternalId && newCustomer) {
    return { error: 'customer', fieldErrors: { customerExternalId: 'customer' } };
  }
  let customerEnrichment: CustomerOrderEnrichmentInput | null = null;
  const customerEnrichmentRaw = optField(fd, 'customerEnrichment');
  if (customerEnrichmentRaw) {
    try {
      const parsedEnrichment = CustomerOrderEnrichmentSchema.safeParse(JSON.parse(customerEnrichmentRaw));
      if (!parsedEnrichment.success || !Object.keys(parsedEnrichment.data).length) {
        return { error: 'customer', fieldErrors: { customerExternalId: 'customer' } };
      }
      customerEnrichment = parsedEnrichment.data;
    } catch {
      return { error: 'customer', fieldErrors: { customerExternalId: 'customer' } };
    }
  }
  if ((!h.data.customerExternalId && customerEnrichment) || (newCustomer && customerEnrichment)) {
    return { error: 'customer', fieldErrors: { customerExternalId: 'customer' } };
  }
  const statusRoles = await getOrderStatusRoleMap();
  const statusRole = statusRoles.get(h.data.status) ?? 'UNKNOWN';
  const saleStatuses = [...statusRoles].filter(([, role]) => role === 'SALE').map(([code]) => code);
  let automaticFinance: Awaited<ReturnType<typeof resolveAutomaticOrderFinance>> | null = null;
  if (h.data.financeMode === 'AUTO') {
    try {
      automaticFinance = await resolveAutomaticOrderFinance({
        channel: h.data.channel,
        fulfillmentMethod: h.data.fulfillmentMethod,
        statusRole,
      });
    } catch (error) {
      orderActionError(error, { stage: 'automatic_finance', channel: h.data.channel });
      return {
        error: 'finance_configuration',
        formError: 'finance_configuration',
        fieldErrors: { financeMode: 'finance_configuration' },
      };
    }
  }
  const financeMode = automaticFinance?.mode ?? h.data.financeMode;
  let financeAccountId = automaticFinance?.accountId ?? h.data.financeAccountId;
  const financeProviderId = automaticFinance?.providerId ?? h.data.financeProviderId;
  const financePaymentMethod = automaticFinance?.paymentMethod ?? h.data.financePaymentMethod;
  if (financeMode === 'PAID' || financeMode === 'PARTIAL') {
    try {
      financeAccountId = await resolveDirectPaymentAccount(financeAccountId);
    } catch {
      return { error: 'account', fieldErrors: { financeAccountId: 'account' } };
    }
  }
  if (financeMode === 'PROVIDER' && !financeProviderId) {
    return { error: 'provider', fieldErrors: { financeProviderId: 'provider' } };
  }
  const provider = financeMode === 'PROVIDER'
    ? await prisma.party.findFirst({
        where: {
          id: financeProviderId,
          isActive: true,
          collectsOrderPayments: true,
        },
        select: { id: true },
      })
    : null;
  if (financeMode === 'PROVIDER' && !provider) {
    return { error: 'provider', fieldErrors: { financeProviderId: 'provider' } };
  }

  // Resolve products by SKU and build line rows (mirrors the CSV importer).
  const lineData: LineData[] = [];
  for (const l of parsedLines.data) {
    const product = await prisma.product.findUnique({
      where: { sku: l.sku },
      select: { id: true, cogsPerUnit: true, sellUnit: true },
    });
    if (!product) return { error: 'sku', fieldErrors: { lines: 'sku' } };
    lineData.push({
      productId: product.id,
      sku: l.sku,
      quantity: l.quantity,
      unitLabel: product.sellUnit,
      unitGrossPrice: l.unitGrossPrice,
      lineDiscount: l.lineDiscount,
      lineNet: l.unitGrossPrice * l.quantity - l.lineDiscount,
      unitCogsSnapshot: product.cogsPerUnit,
    });
  }

  const existingCustomer = h.data.customerExternalId
    ? await prisma.customer.findUnique({
        where: { externalId: h.data.customerExternalId },
      select: { id: true },
    })
    : null;
  if (h.data.customerExternalId && !existingCustomer) return { error: 'customer', fieldErrors: { customerExternalId: 'customer' } };
  const branch = user.branchId
    ? await prisma.branch.findFirst({ where: { id: user.branchId, isActive: true }, select: { id: true } })
    : await prisma.branch.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (user.branchId && !branch) return { error: 'branch', fieldErrors: { branchId: 'branch' } };
  const gross = lineData.reduce((s, l) => s + l.unitGrossPrice * l.quantity, 0);
  const discount = lineData.reduce((s, l) => s + l.lineDiscount, 0) + h.data.orderDiscount;
  const total = Math.max(0, gross - discount + h.data.deliveryFee + h.data.extraCharges);
  if (financeMode === 'PARTIAL' && (!h.data.financePaidAmount || h.data.financePaidAmount <= 0 || h.data.financePaidAmount >= total)) {
    return { error: 'partial', fieldErrors: { financePaidAmount: 'partial' } };
  }
  if (
    statusRole === 'SALE' &&
    total > 0 &&
    financeMode !== 'PAID' &&
    financeMode !== 'PROVIDER'
  ) {
    return {
      error: 'payment_required',
      formError: 'payment_required',
      fieldErrors: { status: 'payment_required', financeMode: 'payment_required' },
    };
  }

  let order: { id: string; orderNumber: string };
  let stage: OrderCreateStage = 'order_number';
  try {
    order = await prisma.$transaction(async (tx) => {
      await options.beforeExecute?.(tx);
      stage = 'order_number';
      const orderNumber = await generateOrderNumber(tx, h.data.placedAt, h.data.channel);
      const customer = newCustomer
        ? await resolveOrCreateCustomerInTransaction(tx, newCustomer, {
            actorId: user.id,
            source: 'ai-assistant-order',
          })
        : existingCustomer;
      if (!newCustomer && customerEnrichment && customer) {
        stage = 'customer_lookup';
        await enrichCustomerForOrderInTransaction(tx, customer.id, customerEnrichment, {
          actorId: user.id,
          source: 'ai-assistant-order',
        });
      }
      stage = 'stock_sync';
      const stockReadiness = await resolveOrderInventoryReadiness(
        tx,
        lineData.map((line) => line.productId),
      );
      stage = 'order_insert';
      const o = await tx.order.create({
        data: {
          orderNumber,
          placedAt: h.data.placedAt,
          customerId: customer?.id ?? null,
          branchId: branch?.id ?? null,
          createdById: user.id,
          channel: h.data.channel,
          governorate: h.data.governorate,
          fulfillmentMethod: h.data.fulfillmentMethod,
          status: h.data.status,
          grossAmount: gross,
          discountAmount: discount,
          orderDiscount: h.data.orderDiscount,
          extraCharges: h.data.extraCharges,
          notes: h.data.notes ?? null,
          refundAmount: refundFor(statusRole === 'RETURN', gross, discount, h.data.deliveryFee, h.data.extraCharges),
          deliveryFee: h.data.deliveryFee,
          deliveryCost: h.data.deliveryCost,
          inventorySyncMode: stockReadiness.mode,
          lines: { create: lineData },
        },
      });
      // Only statuses mapped as completed sales consume stock. Changing the role
      // on a later edit reverses or reapplies the linked movements atomically.
      stage = 'stock_sync';
      if (statusRole === 'SALE' && stockReadiness.mode === 'NORMAL') {
        await applySoldMovements(tx, o.id, h.data.placedAt, lineData);
        await syncActiveCostForProducts(lineData.map((line) => line.productId), tx);
      }
      if (stockReadiness.mode === 'SKIP_HISTORICAL') {
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'ORDER_STOCK_SYNC_SKIPPED',
            entity: 'Order',
            entityId: o.id,
            metadata: {
              reason: 'products_not_connected_to_inventory',
              skus: stockReadiness.unconfiguredSkus,
              source: 'order-command',
            },
          },
        });
      }
      stage = 'finance_sync';
      await syncOrderFinance(tx, o.id, {
        mode: financeMode as FinanceSyncMode,
        accountId: financeAccountId,
        dueDate: h.data.financeDueDate,
        paidAmount: h.data.financePaidAmount,
        paymentMethod: financePaymentMethod,
        paymentDate: automaticFinance ? h.data.placedAt : h.data.financePaymentDate ?? h.data.placedAt,
        createdById: user.id,
        partyId: provider?.id ?? null,
        statusRole,
      });
      stage = 'customer_stats';
      await syncCustomerStats(tx, customer?.id, saleStatuses);
      const commandResult = { recordId: o.id, recordNumber: o.orderNumber };
      stage = 'commit_hook';
      await options.onCommitted?.(tx, commandResult);
      return { id: o.id, orderNumber: o.orderNumber };
    }, {
      maxWait: 10_000,
      timeout: 60_000,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'action_stale') return { error: 'action_stale' };
    const metadata = {
      channel: h.data.channel,
      customerExternalId: h.data.customerExternalId ?? null,
      status: h.data.status,
      statusRole,
      financeMode,
      lineCount: lineData.length,
      skus: lineData.map((line) => line.sku),
      total,
    };
    const failure = createOrderFailure(stage, error, metadata);
    if (failure.debugId) {
      await persistOrderFailure({
        userId: user.id,
        action: 'CREATE',
        debugId: failure.debugId,
        error,
        metadata,
      });
    }
    return failure;
  }
  try {
    await audit(user.id, 'CREATE', 'Order', { orderNumber: order.orderNumber, lines: lineData.length });
  } catch (error) {
    orderActionError(error, { stage: 'audit', orderId: order.id, orderNumber: order.orderNumber });
  }
  revalidatePath(LIST, 'page');
  revalidatePath(FINANCE, 'page');
  revalidatePath(LEDGER, 'page');
  revalidatePath(DUES, 'page');
  return { ok: true, recordId: order.id, recordNumber: order.orderNumber };
}

export async function createOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = reqField(fd, 'locale') || 'ar';
  const result = await createOrderCommand(fd);
  if (!result?.ok || !result.recordId) return result;
  redirect(`/${locale}/admin/records/orders/${result.recordId}`);
}

export async function updateOrder(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const h = parseHeader(fd);
  if (!h.success) return headerActionError(h);
  const locale = reqField(fd, 'locale') || 'ar';
  if (h.data.financeMode === 'PROVIDER' && !h.data.financeProviderId) {
    return { error: 'provider', fieldErrors: { financeProviderId: 'provider' } };
  }
  const statusRoles = await getOrderStatusRoleMap();
  const statusRole = statusRoles.get(h.data.status) ?? 'UNKNOWN';
  const saleStatuses = [...statusRoles].filter(([, role]) => role === 'SALE').map(([code]) => code);

  // Full edit (CR-2): the submitted line items replace the existing ones and
  // every total is recomputed, so reports/invoice stay in sync automatically.
  let rawLines: unknown;
  try {
    rawLines = JSON.parse(reqField(fd, 'lines') || '[]');
  } catch {
    return { error: 'nolines' };
  }
  const parsedLines = lineSchema.safeParse(rawLines);
  if (!parsedLines.success) return lineActionError(parsedLines);
  if (parsedLines.data.length === 0) return { error: 'nolines', fieldErrors: { lines: 'nolines' } };

  const existing = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      customerId: true,
      inventorySyncMode: true,
      grossAmount: true,
      discountAmount: true,
      refundAmount: true,
      deliveryFee: true,
      extraCharges: true,
      lines: { select: { productId: true } },
    },
  });
  if (!existing) return { error: 'notfound' };
  const existingSoldMovementCount = await prisma.stockMovement.count({
    where: { orderId: id, reason: 'SOLD' },
  });
  const oldProductIds = existing.lines.map((l) => l.productId);
  const existingFinanceEntries = await prisma.financeEntry.findMany({
    where: { OR: [{ orderId: id }, { settles: { is: { orderId: id } } }] },
    select: {
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
    },
  });
  const paymentBefore = invoicePaymentSnapshot(existing, existingFinanceEntries);
  const managedProviderId = paymentBefore.providerPartyId
    ? (
        await prisma.party.findFirst({
          where: {
            id: paymentBefore.providerPartyId,
            isActive: true,
            collectsOrderPayments: true,
          },
          select: { id: true },
        })
      )?.id ?? null
    : null;

  const lineData: LineData[] = [];
  for (const l of parsedLines.data) {
    const product = await prisma.product.findUnique({ where: { sku: l.sku }, select: { id: true, cogsPerUnit: true, sellUnit: true } });
    if (!product) return { error: 'sku' };
    lineData.push({
      productId: product.id,
      sku: l.sku,
      quantity: l.quantity,
      unitLabel: product.sellUnit,
      unitGrossPrice: l.unitGrossPrice,
      lineDiscount: l.lineDiscount,
      lineNet: l.unitGrossPrice * l.quantity - l.lineDiscount,
      unitCogsSnapshot: product.cogsPerUnit,
    });
  }
  const customer = h.data.customerExternalId
    ? await prisma.customer.findUnique({ where: { externalId: h.data.customerExternalId }, select: { id: true } })
    : null;
  if (h.data.customerExternalId && !customer) {
    return { error: 'customer', fieldErrors: { customerExternalId: 'customer' } };
  }
  const gross = lineData.reduce((s, l) => s + l.unitGrossPrice * l.quantity, 0);
  const discount = lineData.reduce((s, l) => s + l.lineDiscount, 0) + h.data.orderDiscount;
  const total = Math.max(0, gross - discount + h.data.deliveryFee + h.data.extraCharges);
  if (h.data.financeMode === 'PARTIAL' && (!h.data.financePaidAmount || h.data.financePaidAmount <= 0 || h.data.financePaidAmount >= total)) {
    return { error: 'partial', fieldErrors: { financePaidAmount: 'partial' } };
  }
  if (total < paymentBefore.paid) {
    return {
      error: 'payment_exceeds_total',
      formError: 'payment_exceeds_total',
      fieldErrors: { lines: 'payment_exceeds_total' },
    };
  }
  if (statusRole === 'RETURN' && paymentBefore.paid > 0) {
    return {
      error: 'refund_required',
      formError: 'refund_required',
      fieldErrors: { status: 'refund_required' },
    };
  }
  const needsCompletionPayment = statusRole === 'SALE' && total > paymentBefore.paid;
  let automaticFinance: Awaited<ReturnType<typeof resolveAutomaticOrderFinance>> | null = null;
  if (h.data.financeMode === 'AUTO') {
    try {
      automaticFinance = await resolveAutomaticOrderFinance({
        channel: h.data.channel,
        fulfillmentMethod: h.data.fulfillmentMethod,
        statusRole,
      });
    } catch (error) {
      orderActionError(error, { stage: 'automatic_finance', orderId: id, channel: h.data.channel });
      return {
        error: 'finance_configuration',
        formError: 'finance_configuration',
        fieldErrors: { financeMode: 'finance_configuration' },
      };
    }
  }
  const financeMode = automaticFinance?.mode ?? h.data.financeMode;
  let financeAccountId = automaticFinance?.accountId ?? h.data.financeAccountId;
  const financeProviderId = automaticFinance?.providerId ?? h.data.financeProviderId;
  const financePaymentMethod = automaticFinance?.paymentMethod ?? h.data.financePaymentMethod;
  if (
    needsCompletionPayment &&
    financeMode !== 'PAID' &&
    financeMode !== 'PROVIDER'
  ) {
    return {
      error: 'payment_required',
      formError: 'payment_required',
      fieldErrors: { status: 'payment_required', financeMode: 'payment_required' },
    };
  }
  if (!needsCompletionPayment && h.data.financeMode !== 'KEEP') {
    return {
      error: 'payment_read_only',
      formError: 'payment_read_only',
      fieldErrors: { financeMode: 'payment_read_only' },
    };
  }
  if (needsCompletionPayment && (financeMode === 'PAID' || financeMode === 'PARTIAL')) {
    try {
      financeAccountId = await resolveDirectPaymentAccount(financeAccountId);
    } catch {
      return { error: 'account', fieldErrors: { financeAccountId: 'account' } };
    }
  }
  if (financeMode === 'PROVIDER' && !financeProviderId) {
    return { error: 'provider', fieldErrors: { financeProviderId: 'provider' } };
  }
  const provider = financeMode === 'PROVIDER'
    ? await prisma.party.findFirst({
        where: {
          id: financeProviderId,
          isActive: true,
          collectsOrderPayments: true,
        },
        select: { id: true },
      })
    : null;
  if (financeMode === 'PROVIDER' && !provider) {
    return { error: 'provider', fieldErrors: { financeProviderId: 'provider' } };
  }
  const previousTotal = invoiceTotal(existing);

  // Replace lines + update header + recompute totals atomically, and reverse +
  // reapply the order's stock deductions. orderNumber is immutable (CR-5).
  try {
    await prisma.$transaction(async (tx) => {
      const stockReadiness = await resolveOrderInventoryReadiness(
        tx,
        lineData.map((line) => line.productId),
      );
      if (
        existing.inventorySyncMode === 'NORMAL' &&
        stockReadiness.mode === 'SKIP_HISTORICAL' &&
        existingSoldMovementCount > 0
      ) {
        throw new Error(`stock_not_configured:${stockReadiness.unconfiguredSkus.join(',')}`);
      }
      const nextInventorySyncMode = existing.inventorySyncMode === 'SKIP_HISTORICAL'
        ? 'SKIP_HISTORICAL'
        : stockReadiness.mode;
      await tx.orderLine.deleteMany({ where: { orderId: id } });
      await tx.stockMovement.deleteMany({ where: { orderId: id } });
      await tx.order.update({
        where: { id },
        data: {
          placedAt: h.data.placedAt,
          customerId: customer?.id ?? null,
          channel: h.data.channel,
          governorate: h.data.governorate,
          fulfillmentMethod: h.data.fulfillmentMethod,
          status: h.data.status,
          grossAmount: gross,
          discountAmount: discount,
          orderDiscount: h.data.orderDiscount,
          extraCharges: h.data.extraCharges,
          notes: h.data.notes ?? null,
          refundAmount: refundFor(statusRole === 'RETURN', gross, discount, h.data.deliveryFee, h.data.extraCharges),
          deliveryFee: h.data.deliveryFee,
          deliveryCost: h.data.deliveryCost,
          inventorySyncMode: nextInventorySyncMode,
          lines: { create: lineData },
        },
      });
      // Prior deductions were cleared above; re-apply only for a completed-sale role.
      if (statusRole === 'SALE' && nextInventorySyncMode === 'NORMAL') {
        await applySoldMovements(tx, id, h.data.placedAt, lineData);
      }
      if (nextInventorySyncMode === 'SKIP_HISTORICAL' && existing.inventorySyncMode === 'NORMAL') {
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'ORDER_STOCK_SYNC_SKIPPED',
            entity: 'Order',
            entityId: id,
            metadata: {
              reason: 'products_not_connected_to_inventory',
              skus: stockReadiness.unconfiguredSkus,
              source: 'order-edit',
            },
          },
        });
      }
      if (needsCompletionPayment) {
        await syncOrderFinance(tx, id, {
          mode: financeMode as FinanceSyncMode,
          accountId: financeAccountId,
          dueDate: h.data.financeDueDate,
          paymentMethod: financePaymentMethod,
          paymentDate: automaticFinance ? h.data.placedAt : h.data.financePaymentDate ?? h.data.placedAt,
          createdById: user.id,
          partyId: provider?.id ?? null,
          statusRole,
        });
      } else if (managedProviderId && (statusRole === 'OPEN' || statusRole === 'SALE')) {
        await syncOrderFinance(tx, id, {
          mode: 'PROVIDER',
          partyId: managedProviderId,
          dueDate: h.data.financeDueDate,
          paymentMethod: paymentBefore.paymentMethod,
          createdById: user.id,
          statusRole,
        });
      } else if (total !== previousTotal && (statusRole === 'OPEN' || statusRole === 'SALE')) {
        if (paymentBefore.route === 'PROVIDER' && paymentBefore.providerPartyId) {
          await syncOrderFinance(tx, id, {
            mode: 'PROVIDER',
            partyId: paymentBefore.providerPartyId,
            dueDate: h.data.financeDueDate,
            paymentMethod: paymentBefore.paymentMethod,
            createdById: user.id,
            statusRole,
          });
        } else if (
          paymentBefore.receivableIds.length > 0 ||
          paymentBefore.route === 'DIRECT'
        ) {
          await syncOrderCustomerBalance(tx, id, {
            dueDate: h.data.financeDueDate,
            createdById: user.id,
          });
        }
      }
      await syncActiveCostForProducts(
        [...oldProductIds, ...lineData.map((line) => line.productId)],
        tx,
      );
      await syncCustomerStats(tx, existing.customerId, saleStatuses);
      if (customer?.id !== existing.customerId) await syncCustomerStats(tx, customer?.id, saleStatuses);
    });
  } catch (error) {
    const debugId = `order-edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    orderActionError(error, { stage: 'order_update', debugId, orderId: id, total, previousTotal });
    await persistOrderFailure({
      userId: user.id,
      action: 'UPDATE',
      debugId,
      error,
      metadata: { orderId: id, total, previousTotal, requestedStatus: h.data.status },
    });
    const code = error instanceof Error ? error.message.split(':')[0] : 'order_update_failed';
    if (code.startsWith('stock_')) {
      return {
        error: 'stock_sync_failed',
        formError: 'stock_sync_failed',
        fieldErrors: { lines: 'stock_sync_failed' },
        debugId,
      };
    }
    return {
      error: code,
      formError: 'order_update_failed',
      debugId,
    };
  }
  await audit(user.id, 'UPDATE', 'Order', {
    id,
    lines: lineData.length,
    gross,
    discount,
    paymentBefore,
    totalAfter: total,
    paymentCapture: needsCompletionPayment ? financeMode : 'KEEP',
  });
  revalidatePath(LIST, 'page');
  revalidatePath(FINANCE, 'page');
  revalidatePath(LEDGER, 'page');
  revalidatePath(DUES, 'page');
  redirect(`/${locale}/admin/records/orders/${id}`);
}

export async function deleteOrder(id: string, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  const statusRoles = await getOrderStatusRoleMap();
  const saleStatuses = [...statusRoles].filter(([, role]) => role === 'SALE').map(([code]) => code);
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, select: { customerId: true } });
    await closeOrderFinance(tx, id);
    await tx.order.delete({ where: { id } }); // lines cascade
    await syncCustomerStats(tx, order?.customerId, saleStatuses);
  });
  await audit(user.id, 'DELETE', 'Order', { id });
  revalidatePath(LIST, 'page');
  revalidatePath(FINANCE, 'page');
  revalidatePath(LEDGER, 'page');
  revalidatePath(DUES, 'page');
  redirect(`/${locale}/admin/records/orders`);
}

export async function bulkUpdateOrders(
  _prev: ActionState,
  fd: FormData,
  options: {
    actorContext?: TrustedCommandContext;
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{ count: number; amountApplied: number }>;
  } = {},
): Promise<ActionState> {
  const user = await resolveCommandActor(CAP, options.actorContext);
  if (!user) return { error: 'forbidden' };
  let ids: unknown;
  try {
    ids = JSON.parse(reqField(fd, 'orderIds') || '[]');
  } catch {
    return { error: 'invalid' };
  }
  const parsed = bulkOrderSchema.safeParse({
    orderIds: ids,
    operation: reqField(fd, 'operation'),
    status: optField(fd, 'status'),
    completionMode: optField(fd, 'completionMode'),
    accountId: optField(fd, 'accountId'),
    providerKey: optField(fd, 'providerKey'),
    paymentMethod: optField(fd, 'paymentMethod'),
    date: optField(fd, 'date'),
  });
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  if (input.operation === 'STATUS' && !input.status) return { error: 'status' };
  if (input.operation === 'RECORD_PAID' && (!input.accountId || !input.date)) return { error: 'account' };
  if (input.operation === 'ASSIGN_PROVIDER' && !input.providerKey) return { error: 'provider' };

  const statusRoles = await getOrderStatusRoleMap();
  const saleStatuses = [...statusRoles].filter(([, role]) => role === 'SALE').map(([code]) => code);
  try {
    const summary = await prisma.$transaction(async (tx) => {
      await options.beforeExecute?.(tx);
      const orders = await tx.order.findMany({
        where: { id: { in: input.orderIds } },
        include: { lines: { select: { productId: true, quantity: true } } },
        orderBy: [{ placedAt: 'asc' }, { createdAt: 'asc' }],
      });
      if (orders.length !== input.orderIds.length) throw new Error('notfound');
      const changedCustomers = new Set<string>();
      const changedProducts = new Set<string>();
      let amountApplied = 0;
      const account = input.accountId
        ? await tx.financeAccount.findUnique({
            where: { id: input.accountId },
            select: { id: true, currency: true, type: true, isActive: true },
          })
        : null;
      if (
        input.accountId &&
        (!account?.isActive || account.currency !== 'IQD' || account.type === 'PAYMENT_GATEWAY')
      ) {
        throw new Error('account');
      }
      const provider = input.providerKey
        ? await tx.party.findUnique({
            where: { externalKey: input.providerKey },
            select: { id: true, collectsOrderPayments: true, isActive: true },
          })
        : null;
      if (
        input.providerKey &&
        (!provider?.isActive || !provider.collectsOrderPayments)
      ) {
        throw new Error('provider');
      }

      if (input.operation === 'STATUS') {
        const nextRole = statusRoles.get(input.status as string) ?? 'UNKNOWN';
        for (const order of orders) {
          const entries = await tx.financeEntry.findMany({
            where: { OR: [{ orderId: order.id }, { settles: { is: { orderId: order.id } } }] },
            select: {
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
            },
          });
          const payment = invoicePaymentSnapshot(order, entries);
          const automatic =
            nextRole === 'SALE' &&
            payment.remaining > 0 &&
            input.completionMode === 'AUTO'
              ? await resolveAutomaticOrderFinance(
                  {
                    channel: order.channel,
                    fulfillmentMethod: order.fulfillmentMethod,
                    statusRole: nextRole,
                  },
                  tx,
                )
              : null;
          if (nextRole === 'SALE' && payment.remaining > 0) {
            if (automatic) {
              // Automatic routing already proved its account/provider configuration.
            } else if (input.completionMode === 'DIRECT') {
              if (!account || !input.date) throw new Error('account');
            } else if (input.completionMode === 'PROVIDER') {
              if (!provider) throw new Error('provider');
            } else {
              throw new Error('payment_required');
            }
          }
          const oldRole = statusRoles.get(order.status) ?? 'UNKNOWN';
          const existingSoldMovementCount = nextRole === 'SALE'
            ? await tx.stockMovement.count({
                where: { orderId: order.id, reason: 'SOLD' },
              })
            : 0;
          const stockReadiness = nextRole === 'SALE'
            ? await resolveOrderInventoryReadiness(
                tx,
                order.lines.map((line) => line.productId),
              )
            : null;
          if (
            order.inventorySyncMode === 'NORMAL' &&
            stockReadiness?.mode === 'SKIP_HISTORICAL' &&
            existingSoldMovementCount > 0
          ) {
            throw new Error(`stock_not_configured:${stockReadiness.unconfiguredSkus.join(',')}`);
          }
          const nextInventorySyncMode = order.inventorySyncMode === 'SKIP_HISTORICAL'
            ? 'SKIP_HISTORICAL'
            : stockReadiness?.mode ?? order.inventorySyncMode;
          if (oldRole !== nextRole) {
            await tx.stockMovement.deleteMany({ where: { orderId: order.id, reason: 'SOLD' } });
            if (nextRole === 'SALE' && nextInventorySyncMode === 'NORMAL') {
              await applySoldMovements(tx, order.id, order.placedAt, order.lines);
            }
            for (const line of order.lines) changedProducts.add(line.productId);
          }
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: input.status,
              inventorySyncMode: nextInventorySyncMode,
            },
          });
          if (
            nextInventorySyncMode === 'SKIP_HISTORICAL' &&
            order.inventorySyncMode === 'NORMAL'
          ) {
            await tx.auditLog.create({
              data: {
                userId: user.id,
                action: 'ORDER_STOCK_SYNC_SKIPPED',
                entity: 'Order',
                entityId: order.id,
                metadata: {
                  reason: 'products_not_connected_to_inventory',
                  skus: stockReadiness?.unconfiguredSkus ?? [],
                  source: 'bulk-order-status',
                },
              },
            });
          }
          if (nextRole === 'SALE' && payment.remaining > 0) {
            await syncOrderFinance(tx, order.id, {
              mode:
                automatic?.mode ??
                (input.completionMode === 'PROVIDER' ? 'PROVIDER' : 'PAID'),
              accountId: automatic?.accountId ?? account?.id ?? null,
              partyId: automatic?.providerId ?? provider?.id ?? null,
              paymentMethod: automatic?.paymentMethod ?? input.paymentMethod ?? null,
              paymentDate: automatic ? order.placedAt : input.date ?? null,
              createdById: user.id,
              statusRole: nextRole,
            });
            amountApplied += payment.remaining;
          }
          if (order.customerId) changedCustomers.add(order.customerId);
        }
      }

      if (input.operation === 'ASSIGN_PROVIDER') {
        if (!provider) throw new Error('provider');
        for (const order of orders) {
          const role = statusRoles.get(order.status) ?? 'UNKNOWN';
          if (role !== 'OPEN' && role !== 'SALE') throw new Error('status');
          await syncOrderFinance(tx, order.id, {
            mode: 'PROVIDER',
            partyId: provider.id,
            paymentMethod: input.paymentMethod ?? null,
            paymentDate: input.date ?? null,
            createdById: user.id,
            statusRole: role,
          });
        }
      }

      if (input.operation === 'RECORD_PAID') {
        if (!account || !input.date) throw new Error('account');
        for (const order of orders) {
          const entries = await tx.financeEntry.findMany({
            where: { OR: [{ orderId: order.id }, { settles: { is: { orderId: order.id } } }] },
            select: {
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
            },
          });
          const payment = invoicePaymentSnapshot(order, entries);
          if (payment.remaining <= 0) continue;
          const role = statusRoles.get(order.status) ?? 'UNKNOWN';
          if (role !== 'OPEN' && role !== 'SALE') throw new Error('status');
          await syncOrderFinance(tx, order.id, {
            mode: 'PAID',
            accountId: account.id,
            paymentMethod: input.paymentMethod ?? null,
            paymentDate: input.date,
            createdById: user.id,
            statusRole: role,
          });
          amountApplied += payment.remaining;
        }
      }

      await syncActiveCostForProducts([...changedProducts], tx);
      for (const customerId of changedCustomers) await syncCustomerStats(tx, customerId, saleStatuses);
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: `BULK_ORDER_${input.operation}`,
          entity: 'Order',
          metadata: {
            orderIds: input.orderIds,
            count: orders.length,
            status: input.status ?? null,
            completionMode: input.completionMode ?? null,
            providerKey: input.providerKey ?? null,
            accountId: input.accountId ?? null,
            amountApplied,
          },
        },
      });
      const commandResult = { count: orders.length, amountApplied };
      await options.onCommitted?.(tx, commandResult);
      return commandResult;
    }, { timeout: 60_000 });
    await audit(user.id, 'BULK_ORDER_COMPLETE', 'Order', summary);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'invalid' };
  }

  revalidatePath(LIST, 'page');
  revalidatePath(FINANCE, 'page');
  revalidatePath(LEDGER, 'page');
  revalidatePath(DUES, 'page');
  return { ok: true };
}

const invoicePaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  accountId: z.string().min(1),
  paymentMethod: z.string().optional(),
  date: z.coerce.date(),
});

const InvoicePaymentCommandSchema = invoicePaymentSchema.extend({
  orderId: z.string().min(1),
}).strict();

export type InvoicePaymentCommandInput = z.input<typeof InvoicePaymentCommandSchema>;

export async function recordInvoicePaymentFromInput(
  rawInput: InvoicePaymentCommandInput,
  options: {
    actorContext?: TrustedCommandContext;
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{
      recordId: string;
      orderId: string;
      orderNumber: string;
      amount: number;
      remainingBefore: number;
    }>;
  } = {},
) {
  const user = await resolveCommandActor('manage:finance', options.actorContext);
  if (!user) throw new Error('forbidden');
  const input = InvoicePaymentCommandSchema.parse(rawInput);

  return prisma.$transaction(async (tx) => {
    await options.beforeExecute?.(tx);
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        status: true,
        orderNumber: true,
        grossAmount: true,
        discountAmount: true,
        refundAmount: true,
        deliveryFee: true,
        extraCharges: true,
        currency: true,
        branchId: true,
      },
    });
    if (!order) throw new Error('order_not_found');
    const account = await tx.financeAccount.findFirst({
      where: { id: input.accountId, isActive: true },
      select: { id: true, currency: true },
    });
    if (!account || account.currency !== order.currency) throw new Error('account_currency');
    const readSnapshot = async () => {
      const entries = await tx.financeEntry.findMany({
        where: { OR: [{ orderId: order.id }, { settles: { is: { orderId: order.id } } }] },
        select: {
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
        },
      });
      return invoicePaymentSnapshot(order, entries);
    };
    let snapshot = await readSnapshot();
    if (snapshot.remaining <= 0) throw new Error('invoice_paid');
    if (!snapshot.receivableIds.length) {
      await syncOrderCustomerBalance(tx, order.id, {
        dueDate: input.date,
        createdById: user.id,
      });
      snapshot = await readSnapshot();
    }
    const receivableId = snapshot.receivableIds[0];
    if (!receivableId) throw new Error('receivable_missing');
    const amount = Math.min(toMinor(input.amount, order.currency), snapshot.remaining);
    if (amount <= 0) throw new Error('amount');
    const receivable = await tx.financeEntry.findUnique({
      where: { id: receivableId },
      select: { partyId: true },
    });
    const payment = await tx.financeEntry.create({
      data: {
        date: input.date,
        type: 'PAYMENT_IN',
        amount,
        currency: order.currency,
        obligation: false,
        accountId: account.id,
        partyId: receivable?.partyId ?? null,
        paymentMethod: input.paymentMethod ?? null,
        settlesId: receivableId,
        branchId: order.branchId,
        orderId: order.id,
        reference: order.orderNumber,
        description: `Invoice payment: ${order.orderNumber}`,
        createdById: user.id,
      },
    });
    const result = {
      recordId: payment.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount,
      remainingBefore: snapshot.remaining,
    };
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'INVOICE_PAYMENT',
        entity: 'FinanceEntry',
        entityId: payment.id,
        metadata: {
          orderId: order.id,
          amount,
          total: invoiceTotal(order),
          remainingBefore: snapshot.remaining,
          remainingAfter: snapshot.remaining - amount,
          paymentMethod: input.paymentMethod ?? null,
          accountId: account.id,
        },
      },
    });
    await options.onCommitted?.(tx, result);
    return result;
  });
}

export async function recordInvoicePayment(
  orderId: string,
  fd: FormData,
): Promise<void> {
  const locale = reqField(fd, 'locale') || 'ar';
  const parsed = invoicePaymentSchema.safeParse({
    amount: reqField(fd, 'amount'),
    accountId: reqField(fd, 'accountId'),
    paymentMethod: optField(fd, 'paymentMethod'),
    date: reqField(fd, 'date'),
  });
  if (!parsed.success) return;
  try {
    await recordInvoicePaymentFromInput({ orderId, ...parsed.data });
  } catch {
    return;
  }
  revalidatePath(FINANCE, 'page');
  revalidatePath(LEDGER, 'page');
  revalidatePath(DUES, 'page');
  revalidatePath(`/${locale}/invoice/${orderId}`, 'page');
  redirect(`/${locale}/invoice/${orderId}`);
}

const OrderRefundCommandSchema = z.object({
  orderId: z.string().min(1),
  amount: z.coerce.number().positive(),
  accountId: z.string().min(1),
  paymentMethod: z.string().trim().optional(),
  date: z.coerce.date(),
  reason: z.string().trim().min(3),
}).strict();

export type OrderRefundCommandInput = z.input<typeof OrderRefundCommandSchema>;

export async function recordOrderRefundFromInput(
  rawInput: OrderRefundCommandInput,
  options: {
    actorContext?: TrustedCommandContext;
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{
      recordId: string;
      orderId: string;
      orderNumber: string;
      amount: number;
      refundableBefore: number;
    }>;
  } = {},
) {
  const user = await resolveCommandActor('manage:finance', options.actorContext);
  if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) throw new Error('forbidden');
  const input = OrderRefundCommandSchema.parse(rawInput);
  const saleStatuses = [...await getOrderStatusRoleMap()]
    .filter(([, role]) => role === 'SALE')
    .map(([code]) => code);

  return prisma.$transaction(async (tx) => {
    await options.beforeExecute?.(tx);
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        customerId: true,
        grossAmount: true,
        discountAmount: true,
        refundAmount: true,
        deliveryFee: true,
        extraCharges: true,
        currency: true,
        branchId: true,
      },
    });
    if (!order) throw new Error('order_not_found');
    await tx.$queryRaw`SELECT "id" FROM "FinanceAccount" WHERE "id" = ${input.accountId} FOR UPDATE`;
    const account = await tx.financeAccount.findFirst({
      where: { id: input.accountId, isActive: true, type: { not: 'PAYMENT_GATEWAY' } },
      select: { id: true, currency: true },
    });
    if (!account || account.currency !== order.currency) throw new Error('account_currency');
    const entries = await tx.financeEntry.findMany({
      where: { OR: [{ orderId: order.id }, { settles: { is: { orderId: order.id } } }] },
      select: {
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
      },
    });
    const snapshot = invoicePaymentSnapshot(order, entries);
    const originalTotal = Math.max(
      0,
      order.grossAmount - order.discountAmount + order.deliveryFee + order.extraCharges,
    );
    const refundableBefore = Math.min(
      snapshot.paidRaw,
      Math.max(0, originalTotal - order.refundAmount),
    );
    const amount = toMinor(input.amount, order.currency);
    if (amount <= 0 || amount > refundableBefore) throw new Error('refund_amount_invalid');
    const refund = await tx.financeEntry.create({
      data: {
        date: input.date,
        type: 'PAYMENT_OUT',
        amount,
        currency: order.currency,
        obligation: false,
        accountId: account.id,
        orderId: order.id,
        branchId: order.branchId,
        paymentMethod: input.paymentMethod ?? null,
        reference: order.orderNumber,
        description: `Order refund: ${order.orderNumber} - ${input.reason}`,
        createdById: user.id,
      },
    });
    await tx.order.update({
      where: { id: order.id },
      data: { refundAmount: { increment: amount } },
    });
    await syncCustomerStats(tx, order.customerId, saleStatuses);
    const result = {
      recordId: refund.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount,
      refundableBefore,
    };
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'ORDER_REFUND',
        entity: 'FinanceEntry',
        entityId: refund.id,
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          amount,
          accountId: account.id,
          paymentMethod: input.paymentMethod ?? null,
          reason: input.reason,
          refundableBefore,
        },
      },
    });
    await options.onCommitted?.(tx, result);
    return result;
  });
}
