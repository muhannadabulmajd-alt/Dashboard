'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { FULFILLMENT_METHODS } from '@/lib/enums';
import { invoicePaymentSnapshot, invoiceTotal } from '@/lib/invoice';
import { toMinor } from '@/lib/money';
import { syncActiveCostForProducts } from '@/server/inventory/fifo';
import { closeOrderFinance, syncOrderFinance, type FinanceSyncMode } from '@/server/finance/sync';
import { getOrderStatusRoleMap } from '@/server/lists/resolver';
import { requireCap, audit, reqField, optField, type ActionState } from './shared';

const LIST = '/[locale]/(dashboard)/admin/records/orders';
const FINANCE = '/[locale]/(dashboard)/finance';
const LEDGER = '/[locale]/(dashboard)/finance/ledger';
const DUES = '/[locale]/(dashboard)/finance/dues';
const CAP = 'manage:orders' as const;

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

/**
 * Deduct sold quantities from each variation's linked finished-goods inventory
 * item (variations module §18). Only products that have a linked InventoryItem
 * deduct; others are untracked. Forward-only — existing orders aren't backfilled.
 */
async function applySoldMovements(
  tx: Prisma.TransactionClient,
  orderId: string,
  occurredAt: Date,
  lines: { productId: string; quantity: number }[],
): Promise<void> {
  const ids = lines.map((l) => l.productId);
  const [items, prods] = await Promise.all([
    tx.inventoryItem.findMany({ where: { productId: { in: ids } }, select: { id: true, productId: true } }),
    tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, trackInventory: true } }),
  ]);
  const byProduct = new Map<string, string>();
  for (const i of items) if (i.productId) byProduct.set(i.productId, i.id);
  // Variations with stock tracking turned off (§6, made-to-order) don't deduct.
  const noTrack = new Set(prods.filter((p) => !p.trackInventory).map((p) => p.id));
  const data = lines.flatMap((l) => {
    const inventoryItemId = byProduct.get(l.productId);
    return inventoryItemId && !noTrack.has(l.productId)
      ? [{ inventoryItemId, orderId, occurredAt, reason: 'SOLD' as const, quantity: -l.quantity }]
      : [];
  });
  if (data.length) await tx.stockMovement.createMany({ data });
}

const headerSchema = z.object({
  orderNumber: z.string().min(1),
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
  financeMode: z.enum(['NONE', 'CREDIT', 'PAID', 'PARTIAL']).default('CREDIT'),
  financeAccountId: z.string().optional(),
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

async function syncCustomerStats(
  tx: Prisma.TransactionClient,
  customerId: string | null | undefined,
  saleStatuses: string[],
): Promise<void> {
  if (!customerId) return;
  const stats = await tx.order.aggregate({
    where: { customerId, status: { in: saleStatuses } },
    _count: { _all: true },
    _min: { placedAt: true },
    _max: { placedAt: true },
  });
  await tx.customer.update({
    where: { id: customerId },
    data: {
      ordersCount: stats._count._all,
      firstOrderAt: stats._min.placedAt,
      lastOrderAt: stats._max.placedAt,
    },
  });
}

export async function createOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const h = parseHeader(fd);
  if (!h.success) return { error: 'invalid' };

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(reqField(fd, 'lines') || '[]');
  } catch {
    return { error: 'nolines' };
  }
  const parsedLines = lineSchema.safeParse(rawLines);
  if (!parsedLines.success || parsedLines.data.length === 0) return { error: 'nolines' };

  const locale = reqField(fd, 'locale') || 'ar';
  if (await prisma.order.findUnique({ where: { orderNumber: h.data.orderNumber }, select: { id: true } }))
    return { error: 'exists' };
  if ((h.data.financeMode === 'PAID' || h.data.financeMode === 'PARTIAL') && !h.data.financeAccountId) return { error: 'invalid' };
  const statusRoles = await getOrderStatusRoleMap();
  const statusRole = statusRoles.get(h.data.status) ?? 'UNKNOWN';
  const saleStatuses = [...statusRoles].filter(([, role]) => role === 'SALE').map(([code]) => code);

  // Resolve products by SKU and build line rows (mirrors the CSV importer).
  const lineData: LineData[] = [];
  for (const l of parsedLines.data) {
    const product = await prisma.product.findUnique({
      where: { sku: l.sku },
      select: { id: true, cogsPerUnit: true, sellUnit: true },
    });
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
    ? await prisma.customer.findUnique({
        where: { externalId: h.data.customerExternalId },
        select: { id: true },
      })
    : null;
  const branch = await prisma.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  const gross = lineData.reduce((s, l) => s + l.unitGrossPrice * l.quantity, 0);
  const discount = lineData.reduce((s, l) => s + l.lineDiscount, 0) + h.data.orderDiscount;
  const total = Math.max(0, gross - discount + h.data.deliveryFee + h.data.extraCharges);
  if (h.data.financeMode === 'PARTIAL' && (!h.data.financePaidAmount || h.data.financePaidAmount <= 0 || h.data.financePaidAmount >= total)) {
    return { error: 'invalid' };
  }

  const order = await prisma.$transaction(async (tx) => {
    const o = await tx.order.create({
      data: {
        orderNumber: h.data.orderNumber,
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
    if (statusRole === 'SALE') await applySoldMovements(tx, o.id, h.data.placedAt, lineData);
    await syncOrderFinance(tx, o.id, {
      mode: h.data.financeMode as FinanceSyncMode,
      accountId: h.data.financeAccountId,
      dueDate: h.data.financeDueDate,
      paidAmount: h.data.financePaidAmount,
      paymentMethod: h.data.financePaymentMethod,
      paymentDate: h.data.financePaymentDate,
      createdById: user.id,
      statusRole,
    });
    await syncCustomerStats(tx, customer?.id, saleStatuses);
    return o;
  });
  // Stock consumption changed → roll each linked item's active FIFO cost (§8).
  await syncActiveCostForProducts(lineData.map((l) => l.productId));
  await audit(user.id, 'CREATE', 'Order', { orderNumber: h.data.orderNumber, lines: lineData.length });
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
  if (!h.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  if ((h.data.financeMode === 'PAID' || h.data.financeMode === 'PARTIAL') && !h.data.financeAccountId) return { error: 'invalid' };
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
  if (!parsedLines.success || parsedLines.data.length === 0) return { error: 'nolines' };

  const existing = await prisma.order.findUnique({
    where: { id },
    select: { id: true, customerId: true, lines: { select: { productId: true } } },
  });
  if (!existing) return { error: 'notfound' };
  const oldProductIds = existing.lines.map((l) => l.productId);

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
  const gross = lineData.reduce((s, l) => s + l.unitGrossPrice * l.quantity, 0);
  const discount = lineData.reduce((s, l) => s + l.lineDiscount, 0) + h.data.orderDiscount;
  const total = Math.max(0, gross - discount + h.data.deliveryFee + h.data.extraCharges);
  if (h.data.financeMode === 'PARTIAL' && (!h.data.financePaidAmount || h.data.financePaidAmount <= 0 || h.data.financePaidAmount >= total)) {
    return { error: 'invalid' };
  }

  // Replace lines + update header + recompute totals atomically, and reverse +
  // reapply the order's stock deductions. orderNumber is immutable (CR-5).
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
    if (statusRole === 'SALE') await applySoldMovements(tx, id, h.data.placedAt, lineData);
    await syncOrderFinance(tx, id, {
      mode: h.data.financeMode as FinanceSyncMode,
      accountId: h.data.financeAccountId,
      dueDate: h.data.financeDueDate,
      paidAmount: h.data.financePaidAmount,
      paymentMethod: h.data.financePaymentMethod,
      paymentDate: h.data.financePaymentDate,
      createdById: user.id,
      statusRole,
    });
    await syncCustomerStats(tx, existing.customerId, saleStatuses);
    if (customer?.id !== existing.customerId) await syncCustomerStats(tx, customer?.id, saleStatuses);
  });
  // Re-derive FIFO cost for items touched before or after the edit (a removed
  // line reverses its consumption; an added line consumes), §8.
  await syncActiveCostForProducts([...oldProductIds, ...lineData.map((l) => l.productId)]);
  await audit(user.id, 'UPDATE', 'Order', { id, lines: lineData.length, gross, discount });
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

  const entries = await prisma.financeEntry.findMany({
    where: {
      OR: [{ orderId }, { settles: { is: { orderId } } }],
    },
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
    },
  });
  const snapshot = invoicePaymentSnapshot(order, entries);
  if (snapshot.remaining <= 0 || snapshot.receivableIds.length === 0) return;

  const amount = Math.min(toMinor(parsed.data.amount, order.currency), snapshot.remaining);
  const receivableId = snapshot.receivableIds[0];
  const receivable = await prisma.financeEntry.findUnique({
    where: { id: receivableId },
    select: { partyId: true },
  });

  const payment = await prisma.financeEntry.create({
    data: {
      date: parsed.data.date,
      type: 'PAYMENT_IN',
      amount,
      currency: order.currency,
      obligation: false,
      accountId: parsed.data.accountId,
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
  await audit(user.id, 'INVOICE_PAYMENT', 'FinanceEntry', {
    id: payment.id,
    orderId,
    amount,
    total: invoiceTotal(order),
    remainingBefore: snapshot.remaining,
    paymentMethod: parsed.data.paymentMethod ?? null,
  });
  revalidatePath(FINANCE, 'page');
  revalidatePath(LEDGER, 'page');
  revalidatePath(DUES, 'page');
  revalidatePath(`/${locale}/invoice/${orderId}`, 'page');
  redirect(`/${locale}/invoice/${orderId}`);
}
