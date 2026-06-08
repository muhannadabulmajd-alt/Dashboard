'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { CHANNELS, GOVERNORATES, FULFILLMENT_METHODS, ORDER_STATUSES } from '@/lib/enums';
import { requireCap, audit, reqField, optField, type ActionState } from './shared';

const LIST = '/[locale]/(dashboard)/admin/records/orders';
const CAP = 'manage:orders' as const;

type LineData = {
  productId: string;
  sku: string;
  quantity: number;
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
  const items = await tx.inventoryItem.findMany({
    where: { productId: { in: ids } },
    select: { id: true, productId: true },
  });
  const byProduct = new Map<string, string>();
  for (const i of items) if (i.productId) byProduct.set(i.productId, i.id);
  const data = lines.flatMap((l) => {
    const inventoryItemId = byProduct.get(l.productId);
    return inventoryItemId
      ? [{ inventoryItemId, orderId, occurredAt, reason: 'SOLD' as const, quantity: -l.quantity }]
      : [];
  });
  if (data.length) await tx.stockMovement.createMany({ data });
}

const headerSchema = z.object({
  orderNumber: z.string().min(1),
  placedAt: z.coerce.date(),
  customerExternalId: z.string().optional(),
  channel: z.enum(CHANNELS),
  governorate: z.enum(GOVERNORATES),
  fulfillmentMethod: z.enum(FULFILLMENT_METHODS),
  status: z.enum(ORDER_STATUSES),
  deliveryFee: z.coerce.number().int().nonnegative().default(0),
  deliveryCost: z.coerce.number().int().nonnegative().default(0),
  orderDiscount: z.coerce.number().int().nonnegative().default(0),
  extraCharges: z.coerce.number().int().nonnegative().default(0),
  notes: z.string().optional(),
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
  });
}

const refundFor = (status: string, gross: number, discount: number) =>
  status === 'RETURNED' || status === 'REFUNDED' ? gross - discount : 0;

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

  // Resolve products by SKU and build line rows (mirrors the CSV importer).
  const lineData: LineData[] = [];
  for (const l of parsedLines.data) {
    const product = await prisma.product.findUnique({
      where: { sku: l.sku },
      select: { id: true, cogsPerUnit: true },
    });
    if (!product) return { error: 'sku' };
    lineData.push({
      productId: product.id,
      sku: l.sku,
      quantity: l.quantity,
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

  const order = await prisma.$transaction(async (tx) => {
    const o = await tx.order.create({
      data: {
        orderNumber: h.data.orderNumber,
        placedAt: h.data.placedAt,
        customerId: customer?.id ?? null,
        branchId: branch?.id ?? null,
        channel: h.data.channel,
        governorate: h.data.governorate,
        fulfillmentMethod: h.data.fulfillmentMethod,
        status: h.data.status,
        grossAmount: gross,
        discountAmount: discount,
        orderDiscount: h.data.orderDiscount,
        extraCharges: h.data.extraCharges,
        notes: h.data.notes ?? null,
        refundAmount: refundFor(h.data.status, gross, discount),
        deliveryFee: h.data.deliveryFee,
        deliveryCost: h.data.deliveryCost,
        lines: { create: lineData },
      },
    });
    await applySoldMovements(tx, o.id, h.data.placedAt, lineData);
    return o;
  });
  await audit(user.id, 'CREATE', 'Order', { orderNumber: h.data.orderNumber, lines: lineData.length });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/orders/${order.id}`);
}

export async function updateOrder(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const h = parseHeader(fd);
  if (!h.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';

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

  const existing = await prisma.order.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { error: 'notfound' };

  const lineData: LineData[] = [];
  for (const l of parsedLines.data) {
    const product = await prisma.product.findUnique({ where: { sku: l.sku }, select: { id: true, cogsPerUnit: true } });
    if (!product) return { error: 'sku' };
    lineData.push({
      productId: product.id,
      sku: l.sku,
      quantity: l.quantity,
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
        refundAmount: refundFor(h.data.status, gross, discount),
        deliveryFee: h.data.deliveryFee,
        deliveryCost: h.data.deliveryCost,
        lines: { create: lineData },
      },
    });
    await applySoldMovements(tx, id, h.data.placedAt, lineData);
  });
  await audit(user.id, 'UPDATE', 'Order', { id, lines: lineData.length, gross, discount });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/orders/${id}`);
}

export async function deleteOrder(id: string, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  await prisma.order.delete({ where: { id } }); // lines cascade
  await audit(user.id, 'DELETE', 'Order', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/orders`);
}
