'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
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
import { applySoldMovements, syncCustomerStats } from '@/server/orders/sync';
import { generateOrderNumber } from '@/server/records/numbering';
import { requireCap, audit, reqField, optField, type ActionState } from './shared';

const LIST = '/[locale]/(dashboard)/admin/records/orders';
const FINANCE = '/[locale]/(dashboard)/finance';
const LEDGER = '/[locale]/(dashboard)/finance/ledger';
const DUES = '/[locale]/(dashboard)/finance/dues';
const CAP = 'manage:orders' as const;

const bulkOrderSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(100),
  operation: z.enum(['STATUS', 'RECORD_PAID', 'ASSIGN_PROVIDER']),
  status: z.string().optional(),
  completionMode: z.enum(['DIRECT', 'PROVIDER']).optional(),
  accountId: z.string().optional(),
  providerKey: z.enum(['HI_EXPRESS', 'WAYL']).optional(),
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
  | 'customer_stats';

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
  financeMode: z.enum(['NONE', 'CREDIT', 'PAID', 'PARTIAL', 'PROVIDER', 'KEEP']).default('CREDIT'),
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
    financeMode: optField(fd, 'financeMode') || 'CREDIT',
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
  console.error('[orders.create]', {
    ...context,
    errorName: err?.name,
    errorCode: err?.code,
    errorMessage: err?.message,
  });
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
  return { error: 'create_failed', formError: 'create_failed', stage, debugId };
}

export async function createOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
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

  const locale = reqField(fd, 'locale') || 'ar';
  if (h.data.orderNumber && await prisma.order.findUnique({ where: { orderNumber: h.data.orderNumber }, select: { id: true } }))
    return { error: 'exists', fieldErrors: { orderNumber: 'exists' } };
  if (h.data.financeMode === 'KEEP') {
    return { error: 'invalid', fieldErrors: { financeMode: 'invalid' } };
  }
  if ((h.data.financeMode === 'PAID' || h.data.financeMode === 'PARTIAL') && !h.data.financeAccountId) {
    return { error: 'account', fieldErrors: { financeAccountId: 'account' } };
  }
  if (h.data.financeMode === 'PROVIDER' && !h.data.financeProviderId) {
    return { error: 'provider', fieldErrors: { financeProviderId: 'provider' } };
  }
  const statusRoles = await getOrderStatusRoleMap();
  const statusRole = statusRoles.get(h.data.status) ?? 'UNKNOWN';
  const saleStatuses = [...statusRoles].filter(([, role]) => role === 'SALE').map(([code]) => code);
  const provider = h.data.financeMode === 'PROVIDER'
    ? await prisma.party.findFirst({
        where: {
          id: h.data.financeProviderId,
          isActive: true,
          collectsOrderPayments: true,
        },
        select: { id: true },
      })
    : null;
  if (h.data.financeMode === 'PROVIDER' && !provider) {
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

  const customer = h.data.customerExternalId
    ? await prisma.customer.findUnique({
        where: { externalId: h.data.customerExternalId },
      select: { id: true },
    })
    : null;
  if (h.data.customerExternalId && !customer) return { error: 'customer', fieldErrors: { customerExternalId: 'customer' } };
  const branch = await prisma.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  const gross = lineData.reduce((s, l) => s + l.unitGrossPrice * l.quantity, 0);
  const discount = lineData.reduce((s, l) => s + l.lineDiscount, 0) + h.data.orderDiscount;
  const total = Math.max(0, gross - discount + h.data.deliveryFee + h.data.extraCharges);
  if (h.data.financeMode === 'PARTIAL' && (!h.data.financePaidAmount || h.data.financePaidAmount <= 0 || h.data.financePaidAmount >= total)) {
    return { error: 'partial', fieldErrors: { financePaidAmount: 'partial' } };
  }
  if (
    statusRole === 'SALE' &&
    total > 0 &&
    h.data.financeMode !== 'PAID' &&
    h.data.financeMode !== 'PROVIDER'
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
      stage = 'order_number';
      const orderNumber = await generateOrderNumber(tx, h.data.placedAt, h.data.channel);
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
          lines: { create: lineData },
        },
      });
      // Only statuses mapped as completed sales consume stock. Changing the role
      // on a later edit reverses or reapplies the linked movements atomically.
      stage = 'stock_sync';
      if (statusRole === 'SALE') await applySoldMovements(tx, o.id, h.data.placedAt, lineData);
      stage = 'finance_sync';
      await syncOrderFinance(tx, o.id, {
        mode: h.data.financeMode as FinanceSyncMode,
        accountId: h.data.financeAccountId,
        dueDate: h.data.financeDueDate,
        paidAmount: h.data.financePaidAmount,
        paymentMethod: h.data.financePaymentMethod,
        paymentDate: h.data.financePaymentDate,
        createdById: user.id,
        partyId: provider?.id ?? null,
        statusRole,
      });
      stage = 'customer_stats';
      await syncCustomerStats(tx, customer?.id, saleStatuses);
      return { id: o.id, orderNumber: o.orderNumber };
    });
  } catch (error) {
    return createOrderFailure(stage, error, {
      channel: h.data.channel,
      customerExternalId: h.data.customerExternalId ?? null,
      status: h.data.status,
      statusRole,
      financeMode: h.data.financeMode,
      lineCount: lineData.length,
      skus: lineData.map((line) => line.sku),
      total,
    });
  }
  // Stock consumption changed → roll each linked item's active FIFO cost (§8).
  try {
    await syncActiveCostForProducts(lineData.map((l) => l.productId));
  } catch (error) {
    orderActionError(error, { stage: 'active-cost-sync', orderId: order.id, orderNumber: order.orderNumber });
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
  redirect(`/${locale}/admin/records/orders/${order.id}`);
}

export async function updateOrder(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const h = parseHeader(fd);
  if (!h.success) return headerActionError(h);
  const locale = reqField(fd, 'locale') || 'ar';
  if ((h.data.financeMode === 'PAID' || h.data.financeMode === 'PARTIAL') && !h.data.financeAccountId) {
    return { error: 'account', fieldErrors: { financeAccountId: 'account' } };
  }
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
  if (
    needsCompletionPayment &&
    h.data.financeMode !== 'PAID' &&
    h.data.financeMode !== 'PROVIDER'
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
  const provider = h.data.financeMode === 'PROVIDER'
    ? await prisma.party.findFirst({
        where: {
          id: h.data.financeProviderId,
          isActive: true,
          collectsOrderPayments: true,
        },
        select: { id: true },
      })
    : null;
  if (h.data.financeMode === 'PROVIDER' && !provider) {
    return { error: 'provider', fieldErrors: { financeProviderId: 'provider' } };
  }
  const previousTotal = invoiceTotal(existing);

  // Replace lines + update header + recompute totals atomically, and reverse +
  // reapply the order's stock deductions. orderNumber is immutable (CR-5).
  try {
    await prisma.$transaction(async (tx) => {
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
          lines: { create: lineData },
        },
      });
      // Prior deductions were cleared above; re-apply only for a completed-sale role.
      if (statusRole === 'SALE' && existing.inventorySyncMode === 'NORMAL') {
        await applySoldMovements(tx, id, h.data.placedAt, lineData);
      }
      if (needsCompletionPayment) {
        await syncOrderFinance(tx, id, {
          mode: h.data.financeMode as FinanceSyncMode,
          accountId: h.data.financeAccountId,
          dueDate: h.data.financeDueDate,
          paymentMethod: h.data.financePaymentMethod,
          paymentDate: h.data.financePaymentDate,
          createdById: user.id,
          partyId: provider?.id ?? null,
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
      await syncCustomerStats(tx, existing.customerId, saleStatuses);
      if (customer?.id !== existing.customerId) await syncCustomerStats(tx, customer?.id, saleStatuses);
    });
  } catch (error) {
    const debugId = `order-edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    orderActionError(error, { stage: 'order_update', debugId, orderId: id, total, previousTotal });
    return {
      error: error instanceof Error ? error.message : 'order_update_failed',
      formError: 'order_update_failed',
      debugId,
    };
  }
  // Re-derive FIFO cost for items touched before or after the edit (a removed
  // line reverses its consumption; an added line consumes), §8.
  await syncActiveCostForProducts([...oldProductIds, ...lineData.map((l) => l.productId)]);
  await audit(user.id, 'UPDATE', 'Order', {
    id,
    lines: lineData.length,
    gross,
    discount,
    paymentBefore,
    totalAfter: total,
    paymentCapture: needsCompletionPayment ? h.data.financeMode : 'KEEP',
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

export async function bulkUpdateOrders(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
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
      const orders = await tx.order.findMany({
        where: { id: { in: input.orderIds } },
        include: { lines: { select: { productId: true, quantity: true } } },
        orderBy: [{ placedAt: 'asc' }, { createdAt: 'asc' }],
      });
      if (orders.length !== input.orderIds.length) throw new Error('notfound');
      const changedCustomers = new Set<string>();
      let amountApplied = 0;
      const account = input.accountId
        ? await tx.financeAccount.findUnique({
            where: { id: input.accountId },
            select: { id: true, currency: true },
          })
        : null;
      if (input.accountId && (!account || account.currency !== 'IQD')) throw new Error('account');
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
          if (nextRole === 'SALE' && payment.remaining > 0) {
            if (input.completionMode === 'DIRECT') {
              if (!account || !input.date) throw new Error('account');
            } else if (input.completionMode === 'PROVIDER') {
              if (!provider) throw new Error('provider');
            } else {
              throw new Error('payment_required');
            }
          }
          const oldRole = statusRoles.get(order.status) ?? 'UNKNOWN';
          if (oldRole !== nextRole) {
            await tx.stockMovement.deleteMany({ where: { orderId: order.id, reason: 'SOLD' } });
            if (nextRole === 'SALE' && order.inventorySyncMode === 'NORMAL') {
              await applySoldMovements(tx, order.id, order.placedAt, order.lines);
            }
          }
          await tx.order.update({ where: { id: order.id }, data: { status: input.status } });
          if (nextRole === 'SALE' && payment.remaining > 0) {
            await syncOrderFinance(tx, order.id, {
              mode: input.completionMode === 'PROVIDER' ? 'PROVIDER' : 'PAID',
              accountId: account?.id ?? null,
              partyId: provider?.id ?? null,
              paymentMethod: input.paymentMethod ?? null,
              paymentDate: input.date ?? null,
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
      return { count: orders.length, amountApplied };
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

export async function recordInvoicePayment(
  orderId: string,
  fd: FormData,
): Promise<void> {
  const user = await requireCap('manage:finance');
  if (!user) return;
  const locale = reqField(fd, 'locale') || 'ar';
  const parsed = invoicePaymentSchema.safeParse({
    amount: reqField(fd, 'amount'),
    accountId: reqField(fd, 'accountId'),
    paymentMethod: optField(fd, 'paymentMethod'),
    date: reqField(fd, 'date'),
  });
  if (!parsed.success) return;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
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
  if (!order) return;

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.financeAccount.findUnique({
      where: { id: parsed.data.accountId },
      select: { id: true, currency: true },
    });
    if (!account || account.currency !== order.currency) throw new Error('account');
    const readSnapshot = async () => {
      const entries = await tx.financeEntry.findMany({
        where: { OR: [{ orderId }, { settles: { is: { orderId } } }] },
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
    if (snapshot.remaining <= 0) return null;
    if (!snapshot.receivableIds.length) {
      await syncOrderCustomerBalance(tx, orderId, {
        dueDate: parsed.data.date,
        createdById: user.id,
      });
      snapshot = await readSnapshot();
    }
    const receivableId = snapshot.receivableIds[0];
    if (!receivableId) throw new Error('receivable');
    const amount = Math.min(toMinor(parsed.data.amount, order.currency), snapshot.remaining);
    const receivable = await tx.financeEntry.findUnique({
      where: { id: receivableId },
      select: { partyId: true },
    });
    const payment = await tx.financeEntry.create({
      data: {
        date: parsed.data.date,
        type: 'PAYMENT_IN',
        amount,
        currency: order.currency,
        obligation: false,
        accountId: account.id,
        partyId: receivable?.partyId ?? null,
        paymentMethod: parsed.data.paymentMethod ?? null,
        settlesId: receivableId,
        branchId: order.branchId,
        orderId: order.id,
        reference: order.orderNumber,
        description: `Invoice payment: ${order.orderNumber}`,
        createdById: user.id,
      },
    });
    return { payment, amount, remainingBefore: snapshot.remaining };
  });
  if (!result) return;
  await audit(user.id, 'INVOICE_PAYMENT', 'FinanceEntry', {
    id: result.payment.id,
    orderId,
    amount: result.amount,
    total: invoiceTotal(order),
    remainingBefore: result.remainingBefore,
    paymentMethod: parsed.data.paymentMethod ?? null,
  });
  revalidatePath(FINANCE, 'page');
  revalidatePath(LEDGER, 'page');
  revalidatePath(DUES, 'page');
  revalidatePath(`/${locale}/invoice/${orderId}`, 'page');
  redirect(`/${locale}/invoice/${orderId}`);
}
