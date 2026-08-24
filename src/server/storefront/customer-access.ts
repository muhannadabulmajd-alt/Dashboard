import 'server-only';

import { randomBytes } from 'node:crypto';
import { prisma } from '@/server/db/client';
import { normalizeIraqiPhone } from '@/lib/phone';
import { invoicePaymentSnapshot } from '@/lib/invoice';
import { sha256Hex } from './auth';
import { storefrontBearerToken, storefrontOrderLookupSchema } from './contracts';
import { storefrontImageReference } from './media';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class StorefrontCustomerAccessError extends Error {
  constructor(
    readonly code: 'invalid_request' | 'order_not_found' | 'session_invalid',
    readonly status: number,
  ) {
    super(code);
    this.name = 'StorefrontCustomerAccessError';
  }
}

const orderInclude = {
  customer: { select: { id: true, nameEn: true, nameAr: true, phone: true, address1: true, street: true, governorate: true } },
  lines: {
    orderBy: { id: 'asc' as const },
    select: {
      sku: true, quantity: true, unitLabel: true, unitGrossPrice: true, lineDiscount: true, lineNet: true,
      product: {
        select: {
          nameEn: true,
          nameAr: true,
          imageUrl: true,
          storefrontSlug: true,
          group: { select: { imageUrl: true } },
        },
      },
    },
  },
  storefrontCheckout: {
    select: { id: true, status: true, paymentMode: true, waylUrl: true, expiresAt: true, paidAt: true },
  },
} as const;

type StorefrontOrderRecord = Awaited<ReturnType<typeof loadOrderByNumber>>;

async function loadOrderByNumber(orderNumber: string) {
  return prisma.order.findUnique({ where: { orderNumber }, include: orderInclude });
}

async function financeEntries(orderIds: string[]) {
  if (!orderIds.length) return [];
  return prisma.financeEntry.findMany({
    where: {
      OR: [
        { orderId: { in: orderIds } },
        { settles: { is: { orderId: { in: orderIds } } } },
      ],
    },
    include: {
      account: { select: { name: true } },
      party: { select: { id: true, name: true, collectsOrderPayments: true } },
      settles: { select: { orderId: true } },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
}

function customerOwnsOrder(order: NonNullable<StorefrontOrderRecord>, phone: string): boolean {
  const supplied = normalizeIraqiPhone(phone);
  const saved = normalizeIraqiPhone(order.customer?.phone);
  return Boolean(supplied && saved && supplied === saved);
}

function publicOrder(
  order: NonNullable<StorefrontOrderRecord>,
  entries: Awaited<ReturnType<typeof financeEntries>>,
) {
  const payment = invoicePaymentSnapshot(
    order,
    entries.filter((entry) => entry.orderId === order.id || entry.settles?.orderId === order.id),
  );
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    placedAt: order.placedAt.toISOString(),
    status: order.status,
    channel: order.channel,
    governorate: order.governorate,
    fulfillmentMethod: order.fulfillmentMethod,
    currency: order.currency,
    grossAmount: order.grossAmount,
    discountAmount: order.discountAmount,
    deliveryFee: order.deliveryFee,
    total: payment.total,
    payment: {
      status: payment.status,
      paid: payment.paid,
      remaining: payment.remaining,
      route: payment.route,
    },
    customer: order.customer ? {
      nameEn: order.customer.nameEn,
      nameAr: order.customer.nameAr,
      phone: order.customer.phone,
      governorate: order.customer.governorate,
      address1: order.customer.address1,
      street: order.customer.street,
    } : null,
    lines: order.lines.map((line) => ({
      sku: line.sku,
      quantity: line.quantity,
      unit: line.unitLabel,
      unitPrice: line.unitGrossPrice,
      discount: line.lineDiscount,
      total: line.lineNet,
      nameEn: line.product.nameEn,
      nameAr: line.product.nameAr,
      imageUrl: line.product.storefrontSlug
        ? storefrontImageReference(
          line.product.imageUrl ?? line.product.group?.imageUrl ?? null,
          'products',
          line.product.storefrontSlug,
        )
        : null,
      productSlug: line.product.storefrontSlug,
    })),
    checkout: order.storefrontCheckout ? {
      id: order.storefrontCheckout.id,
      status: order.storefrontCheckout.status,
      paymentMode: order.storefrontCheckout.paymentMode,
      paymentUrl: order.storefrontCheckout.waylUrl,
      expiresAt: order.storefrontCheckout.expiresAt?.toISOString() ?? null,
      paidAt: order.storefrontCheckout.paidAt?.toISOString() ?? null,
    } : null,
  };
}

export async function lookupStorefrontOrder(raw: unknown) {
  const input = storefrontOrderLookupSchema.parse(raw);
  const order = await loadOrderByNumber(input.orderNumber);
  if (!order || !order.customerId || !customerOwnsOrder(order, input.phone)) {
    throw new StorefrontCustomerAccessError('order_not_found', 404);
  }
  const entries = await financeEntries([order.id]);
  return publicOrder(order, entries);
}

export async function createStorefrontCustomerSession(raw: unknown) {
  const input = storefrontOrderLookupSchema.parse(raw);
  const order = await loadOrderByNumber(input.orderNumber);
  if (!order || !order.customerId || !customerOwnsOrder(order, input.phone)) {
    throw new StorefrontCustomerAccessError('order_not_found', 404);
  }
  const session = await createStorefrontSessionForCustomer(order.customerId);
  const entries = await financeEntries([order.id]);
  return { ...session, order: publicOrder(order, entries) };
}

export async function createStorefrontSessionForCustomer(customerId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.storefrontCustomerSession.create({
    data: { customerId, tokenHash: sha256Hex(token), expiresAt },
  });
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function requireActiveStorefrontSession(authorization: string | null) {
  const token = storefrontBearerToken(authorization);
  if (!token) throw new StorefrontCustomerAccessError('session_invalid', 401);
  const session = await prisma.storefrontCustomerSession.findUnique({
    where: { tokenHash: sha256Hex(token) },
    select: { id: true, customerId: true, expiresAt: true, revokedAt: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    throw new StorefrontCustomerAccessError('session_invalid', 401);
  }
  await prisma.storefrontCustomerSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
  return { session, token };
}

export async function getStorefrontCustomerOrders(authorization: string | null) {
  const { session } = await requireActiveStorefrontSession(authorization);
  const orders = await prisma.order.findMany({
    where: { customerId: session.customerId },
    include: orderInclude,
    orderBy: [{ placedAt: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  const entries = await financeEntries(orders.map((order) => order.id));
  return orders.map((order) => publicOrder(order, entries));
}

export async function revokeStorefrontCustomerSession(authorization: string | null) {
  const { session } = await requireActiveStorefrontSession(authorization);
  await prisma.storefrontCustomerSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
}
