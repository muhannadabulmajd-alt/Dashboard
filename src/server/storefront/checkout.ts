import 'server-only';

import { randomUUID } from 'node:crypto';
import type { StorefrontCheckoutStatus } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { normalizeIraqiPhone } from '@/lib/phone';
import { createTrustedCommandContext } from '@/server/commands/actor-context';
import { createOrderCommand } from '@/server/records/orders';
import { quoteStorefrontOrder } from './catalog';
import {
  deriveStorefrontCheckoutToken,
  storefrontCheckoutTokenHash,
  verifyStorefrontCheckoutToken,
} from './auth';
import type { StorefrontConfig } from './config';
import {
  storefrontCheckoutSchema,
  type StorefrontCheckoutInput,
  validIdempotencyKey,
} from './contracts';
import { WaylClient, WaylClientError } from './wayl';
import { reconcileWaylCheckout } from './webhook';

export { storefrontCheckoutSchema, classifyWaylStatus, checkoutEventKey } from './contracts';
export type { StorefrontCheckoutInput } from './contracts';

export class StorefrontCheckoutError extends Error {
  constructor(
    readonly code:
      | 'invalid_request'
      | 'invalid_idempotency_key'
      | 'idempotency_conflict'
      | 'quote_changed'
      | 'customer_ambiguous'
      | 'integration_actor_missing'
      | 'order_failed'
      | 'payment_amount_too_low'
      | 'payment_link_failed'
      | 'checkout_not_found'
      | 'checkout_access_denied',
    readonly status: number = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'StorefrontCheckoutError';
  }
}

type EnabledStorefrontConfig = StorefrontConfig & {
  enabled: true;
  apiKey: string;
  origin: string;
  wayl: NonNullable<StorefrontConfig['wayl']>;
};

function publicCheckout(checkout: {
  id: string;
  status: StorefrontCheckoutStatus;
  paymentMode: 'WAYL' | 'COD';
  subtotal: number;
  deliveryFee: number;
  total: number;
  currency: 'IQD' | 'USD';
  waylUrl: string | null;
  expiresAt: Date | null;
  paidAt: Date | null;
  reviewReason: string | null;
  order: { id: string; orderNumber: string; status: string };
}) {
  return {
    id: checkout.id,
    status: checkout.status,
    paymentMode: checkout.paymentMode,
    subtotal: checkout.subtotal,
    deliveryFee: checkout.deliveryFee,
    total: checkout.total,
    currency: checkout.currency,
    paymentUrl: checkout.waylUrl,
    expiresAt: checkout.expiresAt?.toISOString() ?? null,
    paidAt: checkout.paidAt?.toISOString() ?? null,
    reviewRequired: checkout.status === 'REVIEW',
    reviewReason: checkout.status === 'REVIEW' ? checkout.reviewReason : null,
    order: checkout.order,
  };
}

async function findIntegrationActor() {
  const owner = await prisma.user.findFirst({
    where: { isActive: true, role: 'OWNER' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true, role: true, branchId: true },
  });
  if (owner) return owner;
  return prisma.user.findFirst({
    where: { isActive: true, role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true, role: true, branchId: true },
  });
}

async function resolveCustomer(input: StorefrontCheckoutInput['customer']) {
  const normalizedPhone = normalizeIraqiPhone(input.phone);
  const matches = normalizedPhone
    ? await prisma.customer.findMany({
        where: { isActive: true, normalizedPhone },
        select: { externalId: true },
        take: 2,
      })
    : [];
  if (matches.length > 1) {
    throw new StorefrontCheckoutError('customer_ambiguous', 409);
  }
  return matches[0]?.externalId ?? null;
}

function buildOrderForm(
  input: StorefrontCheckoutInput,
  quote: Awaited<ReturnType<typeof quoteStorefrontOrder>>,
  customerExternalId: string | null,
) {
  const fd = new FormData();
  const placedAt = new Date();
  fd.set('placedAt', placedAt.toISOString());
  fd.set('channel', 'ONLINE_STORE');
  fd.set('governorate', quote.deliveryZone?.governorate || input.customer.governorate);
  fd.set('fulfillmentMethod', quote.deliveryZone ? 'COURIER' : 'PICKUP');
  fd.set('status', 'PENDING');
  fd.set('deliveryFee', String(quote.deliveryFee));
  fd.set('deliveryCost', '0');
  fd.set('orderDiscount', '0');
  fd.set('extraCharges', '0');
  fd.set('financeMode', input.paymentMode === 'COD' ? 'CREDIT' : 'NONE');
  fd.set('financeDueDate', placedAt.toISOString());
  fd.set('notes', 'Created by Laheeb Storefront');
  fd.set('lines', JSON.stringify(quote.lines.map((line) => ({
    sku: line.sku,
    quantity: line.quantity,
    unitGrossPrice: line.unitPrice,
    lineDiscount: 0,
  }))));
  if (customerExternalId) {
    fd.set('customerExternalId', customerExternalId);
  } else {
    fd.set('newCustomer', JSON.stringify({
      ...(input.locale === 'ar' ? { nameAr: input.customer.name } : { nameEn: input.customer.name }),
      phone: input.customer.phone,
      email: input.customer.email || undefined,
      governorate: input.customer.governorate,
      address1: input.customer.address1,
      street: input.customer.street,
      campaignSource: 'ONLINE_STORE',
      segment: 'NEW',
    }));
  }
  return fd;
}

async function loadCheckout(idempotencyKey: string) {
  return prisma.storefrontCheckout.findUnique({
    where: { idempotencyKey },
    include: { order: { select: { id: true, orderNumber: true, status: true } } },
  });
}

async function ensureWaylLink(
  checkout: NonNullable<Awaited<ReturnType<typeof loadCheckout>>>,
  quote: Awaited<ReturnType<typeof quoteStorefrontOrder>>,
  config: EnabledStorefrontConfig,
  dashboardOrigin: string,
  locale: StorefrontCheckoutInput['locale'],
) {
  if (checkout.paymentMode !== 'WAYL' || checkout.status === 'PAID' || checkout.waylUrl) return checkout;
  const client = new WaylClient(config.wayl);
  try {
    const link = await client.createPaymentLink({
      referenceId: checkout.order.orderNumber,
      total: checkout.total,
      lineItems: [
        ...quote.lines.map((line) => ({
          label: `${line.nameEn} x ${line.quantity}`.slice(0, 120),
          amount: line.lineTotal,
          type: 'increase' as const,
        })),
        ...(quote.deliveryFee > 0
          ? [{ label: 'Delivery', amount: quote.deliveryFee, type: 'increase' as const }]
          : []),
      ],
      customParameter: checkout.id,
      webhookUrl: `${dashboardOrigin}/api/storefront/v1/wayl/webhook`,
      redirectionUrl: `${config.origin}/${locale}/checkout/return?checkout=${encodeURIComponent(checkout.id)}`,
      expiresIn: '1h',
    });
    return prisma.storefrontCheckout.update({
      where: { id: checkout.id },
      data: {
        status: 'PAYMENT_PENDING',
        waylReferenceId: link.referenceId,
        waylLinkId: link.id,
        waylCode: link.code ?? null,
        waylUrl: link.url,
        waylStatus: link.status,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        reviewReason: null,
      },
      include: { order: { select: { id: true, orderNumber: true, status: true } } },
    });
  } catch (error) {
    const safeCode = error instanceof WaylClientError ? error.code : 'unknown';
    await prisma.storefrontCheckout.update({
      where: { id: checkout.id },
      data: { status: 'REVIEW', reviewReason: `payment_link_${safeCode}` },
    });
    throw new StorefrontCheckoutError('payment_link_failed', 502, { checkoutId: checkout.id });
  }
}

export function validateIdempotencyKey(value: string | null): string {
  const key = validIdempotencyKey(value);
  if (!key) {
    throw new StorefrontCheckoutError('invalid_idempotency_key', 400);
  }
  return key;
}

export async function createStorefrontCheckout(
  rawInput: StorefrontCheckoutInput,
  options: {
    idempotencyKey: string;
    config: EnabledStorefrontConfig;
    dashboardOrigin: string;
  },
) {
  const input = storefrontCheckoutSchema.parse(rawInput);
  const idempotencyKey = validateIdempotencyKey(options.idempotencyKey);
  const quote = await quoteStorefrontOrder({ lines: input.lines, deliveryZoneCode: input.deliveryZoneCode });
  if (quote.quoteHash !== input.quoteHash) {
    throw new StorefrontCheckoutError('quote_changed', 409, { quote });
  }
  if (input.paymentMode === 'WAYL' && quote.total < 1_000) {
    throw new StorefrontCheckoutError('payment_amount_too_low', 400, { minimum: 1_000 });
  }

  let checkout = await loadCheckout(idempotencyKey);
  if (
    checkout
    && (
      checkout.quoteHash !== quote.quoteHash
      || checkout.paymentMode !== input.paymentMode
      || checkout.subtotal !== quote.subtotal
      || checkout.deliveryFee !== quote.deliveryFee
      || checkout.total !== quote.total
    )
  ) {
    throw new StorefrontCheckoutError('idempotency_conflict', 409);
  }
  if (!checkout) {
    const [actor, customerExternalId] = await Promise.all([
      findIntegrationActor(),
      resolveCustomer(input.customer),
    ]);
    if (!actor) throw new StorefrontCheckoutError('integration_actor_missing', 503);
    const checkoutId = randomUUID();
    const publicToken = deriveStorefrontCheckoutToken({
      checkoutId,
      apiKey: options.config.apiKey,
    });
    const result = await createOrderCommand(buildOrderForm(input, quote, customerExternalId), {
      actorContext: createTrustedCommandContext(actor),
      onCommitted: async (tx, order) => {
        await tx.storefrontCheckout.create({
          data: {
            id: checkoutId,
            orderId: order.recordId,
            deliveryZoneId: quote.deliveryZone?.code
              ? (await tx.storefrontDeliveryZone.findUnique({
                  where: { code: quote.deliveryZone.code },
                  select: { id: true },
                }))?.id ?? null
              : null,
            idempotencyKey,
            publicTokenHash: storefrontCheckoutTokenHash(publicToken),
            paymentMode: input.paymentMode,
            status: input.paymentMode === 'COD' ? 'COD_PENDING' : 'CREATED',
            subtotal: quote.subtotal,
            discountAmount: quote.discountAmount,
            deliveryFee: quote.deliveryFee,
            total: quote.total,
            quoteHash: quote.quoteHash,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            action: 'STOREFRONT_CHECKOUT_CREATED',
            entity: 'Order',
            entityId: order.recordId,
            metadata: {
              paymentMode: input.paymentMode,
              total: quote.total,
              deliveryZone: quote.deliveryZone?.code ?? null,
              source: 'storefront',
            },
          },
        });
      },
    });
    if (!result?.ok) {
      checkout = await loadCheckout(idempotencyKey);
      if (!checkout) {
        throw new StorefrontCheckoutError('order_failed', 409, {
          stage: result?.stage ?? null,
          error: result?.error ?? 'unknown',
        });
      }
    } else {
      checkout = await loadCheckout(idempotencyKey);
    }
  }
  if (!checkout) throw new StorefrontCheckoutError('order_failed', 500);
  checkout = await ensureWaylLink(checkout, quote, options.config, options.dashboardOrigin, input.locale);
  const accessToken = deriveStorefrontCheckoutToken({
    checkoutId: checkout.id,
    apiKey: options.config.apiKey,
  });
  if (!verifyStorefrontCheckoutToken({ token: accessToken, tokenHash: checkout.publicTokenHash })) {
    checkout = await prisma.storefrontCheckout.update({
      where: { id: checkout.id },
      data: { publicTokenHash: storefrontCheckoutTokenHash(accessToken) },
      include: { order: { select: { id: true, orderNumber: true, status: true } } },
    });
  }
  return { ...publicCheckout(checkout), accessToken };
}

export async function getStorefrontCheckout(
  id: string,
  accessToken: string | null,
  config: EnabledStorefrontConfig,
) {
  let checkout = await prisma.storefrontCheckout.findUnique({
    where: { id },
    include: { order: { select: { id: true, orderNumber: true, status: true } } },
  });
  if (!checkout) throw new StorefrontCheckoutError('checkout_not_found', 404);
  if (!verifyStorefrontCheckoutToken({ token: accessToken, tokenHash: checkout.publicTokenHash })) {
    throw new StorefrontCheckoutError('checkout_access_denied', 401);
  }
  if (
    checkout.paymentMode === 'WAYL'
    && checkout.waylReferenceId
    && ['CREATED', 'PAYMENT_PENDING'].includes(checkout.status)
  ) {
    await reconcileWaylCheckout({
      referenceId: checkout.waylReferenceId,
      config,
      source: 'storefront-return',
    }).catch(() => undefined);
    checkout = await prisma.storefrontCheckout.findUnique({
      where: { id },
      include: { order: { select: { id: true, orderNumber: true, status: true } } },
    });
    if (!checkout) throw new StorefrontCheckoutError('checkout_not_found', 404);
  }
  return publicCheckout(checkout);
}
