import 'server-only';

import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { syncOrderFinance } from '@/server/finance/sync';
import {
  classifyWaylStatus,
  checkoutEventKey,
  waylWebhookEventDisposition,
  waylWebhookEventId,
  waylWebhookReference,
  waylWebhookStatus,
} from './contracts';
import { sha256Hex } from './auth';
import type { StorefrontConfig } from './config';
import { WaylClient } from './wayl';

type EnabledStorefrontConfig = StorefrontConfig & {
  enabled: true;
  wayl: NonNullable<StorefrontConfig['wayl']>;
};

function jsonObject(value: unknown): Prisma.InputJsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Prisma.InputJsonObject
    : {};
}

async function integrationActorId(tx: Prisma.TransactionClient) {
  const actor = await tx.user.findFirst({
    where: { isActive: true, role: { in: ['OWNER', 'ADMIN'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return actor?.id ?? null;
}

export async function reconcileWaylCheckout(input: {
  referenceId: string;
  config: EnabledStorefrontConfig;
  source: 'wayl-webhook' | 'storefront-return';
}) {
  const authoritative = await new WaylClient(input.config.wayl).getPaymentLink(input.referenceId);
  const checkout = await prisma.storefrontCheckout.findUnique({
    where: { waylReferenceId: input.referenceId },
    include: { order: { select: { id: true, orderNumber: true } } },
  });
  if (!checkout) throw new Error('checkout_not_found');
  if (
    authoritative.referenceId !== checkout.order.orderNumber
    || authoritative.total !== checkout.total
    || authoritative.currency !== checkout.currency
  ) {
    await prisma.storefrontCheckout.update({
      where: { id: checkout.id },
      data: {
        status: 'REVIEW',
        reviewReason: 'wayl_reconciliation_mismatch',
        waylStatus: authoritative.status,
      },
    });
    return { accepted: true, review: true, checkoutId: checkout.id } as const;
  }

  const statusClass = classifyWaylStatus(authoritative.status);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StorefrontCheckout" WHERE "id" = ${checkout.id} FOR UPDATE`;
    const current = await tx.storefrontCheckout.findUnique({ where: { id: checkout.id } });
    if (!current) throw new Error('checkout_not_found');
    const actorId = await integrationActorId(tx);
    if (statusClass === 'PAID' && current.status !== 'PAID') {
      const provider = await tx.party.findFirst({
        where: { externalKey: 'WAYL', isActive: true, collectsOrderPayments: true },
        select: { id: true },
      });
      if (!provider) throw new Error('wayl_provider_missing');
      await syncOrderFinance(tx, checkout.orderId, {
        mode: 'PROVIDER',
        partyId: provider.id,
        paymentMethod: authoritative.paymentMethod ?? 'WAYL',
        paymentDate: authoritative.completedAt ? new Date(authoritative.completedAt) : new Date(),
        createdById: actorId,
        statusRole: 'OPEN',
      });
      await tx.storefrontCheckout.update({
        where: { id: checkout.id },
        data: {
          status: 'PAID',
          waylStatus: authoritative.status,
          paidAt: authoritative.completedAt ? new Date(authoritative.completedAt) : new Date(),
          reviewReason: null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'STOREFRONT_WAYL_PAYMENT_CONFIRMED',
          entity: 'Order',
          entityId: checkout.orderId,
          metadata: {
            referenceId: input.referenceId,
            amount: checkout.total,
            source: input.source,
          },
        },
      });
    } else if (statusClass === 'FAILED' && current.status !== 'PAID') {
      await tx.storefrontCheckout.update({
        where: { id: checkout.id },
        data: { status: 'FAILED', waylStatus: authoritative.status, closedAt: new Date() },
      });
    } else if (statusClass === 'RETURNED' || (statusClass === 'FAILED' && current.status === 'PAID')) {
      await tx.storefrontCheckout.update({
        where: { id: checkout.id },
        data: {
          status: 'REVIEW',
          waylStatus: authoritative.status,
          reviewReason: 'paid_payment_changed',
        },
      });
    } else if (statusClass === 'PENDING') {
      await tx.storefrontCheckout.update({
        where: { id: checkout.id },
        data: { status: 'PAYMENT_PENDING', waylStatus: authoritative.status },
      });
    } else if (statusClass === 'UNKNOWN') {
      await tx.storefrontCheckout.update({
        where: { id: checkout.id },
        data: {
          status: 'REVIEW',
          waylStatus: authoritative.status,
          reviewReason: 'unknown_wayl_status',
        },
      });
    }
  });
  return {
    accepted: true,
    duplicate: false,
    status: statusClass,
    checkoutId: checkout.id,
  } as const;
}

export async function processWaylWebhook(input: {
  rawBody: string;
  signature: string;
  config: EnabledStorefrontConfig;
}) {
  let payload: Prisma.InputJsonObject;
  try {
    payload = jsonObject(JSON.parse(input.rawBody));
  } catch {
    return { accepted: false, code: 'invalid_payload' };
  }
  const referenceId = waylWebhookReference(payload);
  if (!referenceId) return { accepted: false, code: 'missing_reference' };
  const eventKey = checkoutEventKey(input.rawBody, waylWebhookEventId(payload));
  const existing = await prisma.waylWebhookEvent.findUnique({ where: { eventKey }, select: { id: true, status: true } });
  if (waylWebhookEventDisposition(existing?.status ?? null) === 'duplicate') {
    return { accepted: true, duplicate: true, status: existing?.status ?? 'UNKNOWN' };
  }

  let event: { id: string };
  if (existing) {
    event = await prisma.waylWebhookEvent.update({
      where: { id: existing.id },
      data: { status: 'PROCESSING', errorCode: null, processedAt: null },
      select: { id: true },
    });
  } else try {
    event = await prisma.waylWebhookEvent.create({
      data: {
        eventKey,
        referenceId,
        eventType: waylWebhookStatus(payload),
        signatureHash: sha256Hex(input.signature),
        payload,
        status: 'PROCESSING',
      },
      select: { id: true },
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return { accepted: true, duplicate: true };
    }
    throw error;
  }

  try {
    const result = await reconcileWaylCheckout({
      referenceId,
      config: input.config,
      source: 'wayl-webhook',
    });
    await prisma.waylWebhookEvent.update({
      where: { id: event.id },
      data: {
        checkoutId: result.checkoutId,
        status: result.review ? 'IGNORED' : 'SUCCEEDED',
        errorCode: result.review ? 'reconciliation_mismatch' : null,
        processedAt: new Date(),
      },
    });
    return result;
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 100) : 'processing_failed';
    await prisma.waylWebhookEvent.update({
      where: { id: event.id },
      data: { status: 'FAILED', errorCode: code, processedAt: new Date() },
    }).catch(() => undefined);
    throw error;
  }
}
