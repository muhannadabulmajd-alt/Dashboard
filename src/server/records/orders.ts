'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { CHANNELS, GOVERNORATES, FULFILLMENT_METHODS, ORDER_STATUSES } from '@/lib/enums';
import { requireCap, audit, reqField, optField, type ActionState } from './shared';

const LIST = '/[locale]/(dashboard)/admin/records/orders';
const CAP = 'manage:orders' as const;

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
  const lineData = [];
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
  const discount = lineData.reduce((s, l) => s + l.lineDiscount, 0);

  const order = await prisma.order.create({
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
      refundAmount: refundFor(h.data.status, gross, discount),
      deliveryFee: h.data.deliveryFee,
      deliveryCost: h.data.deliveryCost,
      lines: { create: lineData },
    },
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

  const existing = await prisma.order.findUnique({
    where: { id },
    select: { grossAmount: true, discountAmount: true, orderNumber: true },
  });
  if (!existing) return { error: 'notfound' };
  const dup = await prisma.order.findUnique({
    where: { orderNumber: h.data.orderNumber },
    select: { id: true },
  });
  if (dup && dup.id !== id) return { error: 'exists' };

  const customer = h.data.customerExternalId
    ? await prisma.customer.findUnique({
        where: { externalId: h.data.customerExternalId },
        select: { id: true },
      })
    : null;

  await prisma.order.update({
    where: { id },
    data: {
      orderNumber: h.data.orderNumber,
      placedAt: h.data.placedAt,
      customerId: customer?.id ?? null,
      channel: h.data.channel,
      governorate: h.data.governorate,
      fulfillmentMethod: h.data.fulfillmentMethod,
      status: h.data.status,
      refundAmount: refundFor(h.data.status, existing.grossAmount, existing.discountAmount),
      deliveryFee: h.data.deliveryFee,
      deliveryCost: h.data.deliveryCost,
    },
  });
  await audit(user.id, 'UPDATE', 'Order', { id, orderNumber: h.data.orderNumber });
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
