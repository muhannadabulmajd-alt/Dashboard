import 'server-only';
import { randomInt } from 'node:crypto';
import type { TelegramIdentityStatus } from '@prisma/client';
import { prisma } from '@/server/db/client';
import {
  deleteTelegramWebhook,
  getTelegramBot,
  getTelegramWebhookInfo,
  setTelegramWebhook,
  type TelegramWebhookInfo,
} from './api';
import { requireTelegramConfig } from './config';

export type TelegramPreviewVerificationResult = {
  botAuthentication: 'passed';
  webhookAuth: 'passed';
  privateChatOnly: 'passed';
  statusDelivery: 'passed';
  updateIdempotency: 'passed';
  orderCustomerAtomicity: 'passed';
  callbackIdempotency: 'passed';
  pdfPersistence: 'passed';
  telegramDocumentDelivery: 'passed';
  webhookRestoration: 'passed';
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name.toLowerCase()}_missing`);
  return value;
}

function requireSafeTarget(input: { previewOrigin: string; bypassSecret: string }): {
  previewUrl: URL;
  telegramSecret: string;
} {
  if (process.env.VERCEL_ENV !== 'preview') throw new Error('telegram_verification_preview_only');
  if (process.env.AI_PHASE2_VERIFICATION_ENABLED !== 'true') {
    throw new Error('telegram_verification_disabled');
  }
  if (process.env.AI_PHASE2_DATABASE_ISOLATED !== 'true') {
    throw new Error('telegram_preview_requires_isolated_database');
  }
  const databaseUrl = new URL(requiredEnv('DATABASE_URL'));
  const expectedHost = requiredEnv('AI_PHASE2_EXPECTED_DB_HOST');
  if (databaseUrl.hostname !== expectedHost || !databaseUrl.hostname.endsWith('.neon.tech')) {
    throw new Error('telegram_preview_database_identity_mismatch');
  }
  const previewUrl = new URL(input.previewOrigin);
  const deploymentHost = process.env.VERCEL_URL?.trim();
  if (
    previewUrl.protocol !== 'https:'
    || !previewUrl.hostname.endsWith('.vercel.app')
    || previewUrl.hostname === 'dashboard.laheeb.coffee'
    || (deploymentHost && previewUrl.hostname !== deploymentHost)
  ) {
    throw new Error('telegram_preview_target_invalid');
  }
  if (!input.bypassSecret.trim()) throw new Error('telegram_preview_bypass_missing');
  const config = requireTelegramConfig();
  return { previewUrl, telegramSecret: config.webhookSecret };
}

async function nextUpdateId(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = randomInt(1_500_000_000, 2_000_000_000);
    const existing = await prisma.telegramUpdate.findUnique({
      where: { updateId: String(candidate) },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  throw new Error('telegram_preview_update_id_unavailable');
}

async function postUpdate(input: {
  url: URL;
  bypassSecret: string;
  telegramSecret: string;
  update: Record<string, unknown>;
  expectedStatus?: number;
}): Promise<Record<string, unknown>> {
  const response = await fetch(input.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vercel-protection-bypass': input.bypassSecret,
      'x-telegram-bot-api-secret-token': input.telegramSecret,
    },
    body: JSON.stringify(input.update),
    signal: AbortSignal.timeout(20_000),
  });
  const expected = input.expectedStatus ?? 200;
  if (response.status !== expected) throw new Error(`telegram_preview_webhook_${response.status}`);
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

async function waitForUpdate(updateId: number, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const update = await prisma.telegramUpdate.findUnique({
      where: { updateId: String(updateId) },
      select: {
        id: true,
        status: true,
        attempts: true,
        errorCode: true,
        conversationId: true,
        aiMessageId: true,
        replyMessageId: true,
      },
    });
    if (update?.status === 'SUCCEEDED') return update;
    if (update?.status === 'IGNORED') {
      throw new Error(`telegram_preview_update_ignored_${update.errorCode ?? 'unknown'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('telegram_preview_update_timeout');
}

async function restoreWebhook(secret: string, original: TelegramWebhookInfo): Promise<void> {
  if (!original.url) {
    await deleteTelegramWebhook();
    return;
  }
  await setTelegramWebhook({
    url: original.url,
    secretToken: secret,
    maxConnections: original.max_connections,
    allowedUpdates: original.allowed_updates,
  });
}

export async function verifyTelegramPreview(input: {
  previewOrigin: string;
  bypassSecret: string;
  e2eUserId: string;
  productSku: string;
  runId: string;
}): Promise<TelegramPreviewVerificationResult> {
  const { previewUrl, telegramSecret } = requireSafeTarget(input);
  const runId = input.runId.replace(/\D/g, '').slice(-7).padStart(7, '3');
  if (!input.productSku.trim()) throw new Error('telegram_preview_product_missing');

  const originalWebhook = await getTelegramWebhookInfo();
  const bot = await getTelegramBot();
  if (!bot.is_bot || !Number.isSafeInteger(bot.id)) {
    throw new Error('telegram_preview_bot_verification_failed');
  }
  if (originalWebhook.has_custom_certificate) {
    throw new Error('telegram_preview_custom_certificate_unsupported');
  }
  if (originalWebhook.url && new URL(originalWebhook.url).hostname === 'dashboard.laheeb.coffee') {
    throw new Error('telegram_preview_bot_points_to_production');
  }

  const featureWebhook = new URL('/api/telegram/webhook', previewUrl);
  featureWebhook.searchParams.set('x-vercel-protection-bypass', input.bypassSecret);
  let webhookChanged = false;
  let identityRestore: { id: string; userId: string; status: TelegramIdentityStatus; revokedAt: Date | null } | null = null;
  let verificationComplete = false;

  try {
    webhookChanged = true;
    await setTelegramWebhook({
      url: featureWebhook.toString(),
      secretToken: telegramSecret,
      allowedUpdates: ['message', 'callback_query'],
    });
    const registered = await getTelegramWebhookInfo();
    if (registered.url !== featureWebhook.toString()) {
      throw new Error('telegram_preview_webhook_not_registered');
    }

    const webhookEndpoint = new URL('/api/telegram/webhook', previewUrl);
    const rejectedId = await nextUpdateId();
    await postUpdate({
      url: webhookEndpoint,
      bypassSecret: input.bypassSecret,
      telegramSecret: `${telegramSecret}-invalid`,
      expectedStatus: 401,
      update: { update_id: rejectedId },
    });

    const groupId = await nextUpdateId();
    const groupResult = await postUpdate({
      url: webhookEndpoint,
      bypassSecret: input.bypassSecret,
      telegramSecret,
      update: {
        update_id: groupId,
        message: {
          message_id: groupId,
          from: { id: 1, first_name: 'Phase 2 verifier' },
          chat: { id: -1, type: 'group' },
          text: '/status',
        },
      },
    });
    if (groupResult.ignored !== true) throw new Error('telegram_preview_group_not_ignored');

    const identity = await prisma.telegramIdentity.findFirst({
      where: {
        status: 'ACTIVE',
        privateChatId: { not: null },
        user: { is: { isActive: true } },
      },
      orderBy: { linkedAt: 'asc' },
      select: {
        id: true,
        userId: true,
        status: true,
        revokedAt: true,
        telegramUserId: true,
        privateChatId: true,
        firstName: true,
        lastName: true,
        username: true,
      },
    });
    if (!identity?.privateChatId || !identity.userId) {
      throw new Error('telegram_preview_linked_identity_missing');
    }
    const telegramUserId = Number(identity.telegramUserId);
    const privateChatId = Number(identity.privateChatId);
    if (!Number.isSafeInteger(telegramUserId) || !Number.isSafeInteger(privateChatId)) {
      throw new Error('telegram_preview_identity_invalid');
    }
    const e2eUser = await prisma.user.findFirstOrThrow({
      where: { id: input.e2eUserId, email: 'ai-phase2-preview@laheeb.test', role: 'OWNER', isActive: true },
      select: { id: true },
    });
    identityRestore = {
      id: identity.id,
      userId: identity.userId,
      status: identity.status,
      revokedAt: identity.revokedAt,
    };
    await prisma.telegramIdentity.update({
      where: { id: identity.id },
      data: { userId: e2eUser.id, status: 'ACTIVE', revokedAt: null },
    });

    const telegramUser = {
      id: telegramUserId,
      first_name: identity.firstName ?? 'Phase 2 verifier',
      ...(identity.lastName ? { last_name: identity.lastName } : {}),
      ...(identity.username ? { username: identity.username } : {}),
      language_code: 'en',
    };
    const statusUpdateId = await nextUpdateId();
    const statusPayload = {
      update_id: statusUpdateId,
      message: {
        message_id: statusUpdateId,
        from: telegramUser,
        chat: { id: privateChatId, type: 'private' },
        text: '/status',
      },
    };
    await postUpdate({
      url: webhookEndpoint,
      bypassSecret: input.bypassSecret,
      telegramSecret,
      update: statusPayload,
    });
    const statusReceipt = await waitForUpdate(statusUpdateId);
    const duplicateStatus = await postUpdate({
      url: webhookEndpoint,
      bypassSecret: input.bypassSecret,
      telegramSecret,
      update: statusPayload,
    });
    if (duplicateStatus.duplicate !== true) throw new Error('telegram_preview_duplicate_not_detected');
    const duplicateReceipt = await prisma.telegramUpdate.findUniqueOrThrow({
      where: { updateId: String(statusUpdateId) },
      select: { attempts: true },
    });
    if (duplicateReceipt.attempts !== statusReceipt.attempts) {
      throw new Error('telegram_preview_duplicate_reprocessed');
    }

    const customerName = `Phase Two Telegram Customer ${runId}`;
    const phone = `+964770${runId}`;
    const address = `Baghdad Telegram District ${runId}`;
    const street = 'Street 14, building 2';
    const orderMarker = `phase2-telegram-${runId}`;
    const orderUpdateId = await nextUpdateId();
    await postUpdate({
      url: webhookEndpoint,
      bypassSecret: input.bypassSecret,
      telegramSecret,
      update: {
        update_id: orderUpdateId,
        message: {
          message_id: orderUpdateId,
          from: telegramUser,
          chat: { id: privateChatId, type: 'private' },
          text: [
            'Prepare one new PENDING pickup order for confirmation. Preserve every supplied field.',
            `Customer: ${customerName}`,
            `Phone: ${phone}`,
            `Address: ${address}`,
            'Governorate: BAGHDAD',
            `Street: ${street}`,
            'Customer notes: Phase 2 Telegram isolated verification',
            `Product: 1 x ${input.productSku}`,
            'Channel: POS',
            'Fulfillment: PICKUP',
            'Status: PENDING',
            'Payment: NONE',
            'Delivery fee: 0 IQD',
            'Order discount: 0 IQD',
            `Order notes: ${orderMarker}`,
            'This customer is new; create it atomically with the confirmed order.',
          ].join('\n'),
        },
      },
    });
    const orderPreviewReceipt = await waitForUpdate(orderUpdateId);
    if (!orderPreviewReceipt.conversationId || !orderPreviewReceipt.replyMessageId) {
      throw new Error('telegram_preview_order_preview_missing');
    }
    const pendingAction = await prisma.aiPendingAction.findFirstOrThrow({
      where: {
        conversationId: orderPreviewReceipt.conversationId,
        userId: e2eUser.id,
        type: 'CREATE_ORDER',
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, validatedData: true },
    });
    const validated = JSON.stringify(pendingAction.validatedData);
    for (const expected of [customerName, runId, address, street, input.productSku, orderMarker]) {
      if (!validated.includes(expected)) throw new Error('telegram_preview_order_field_missing');
    }

    const callbackUpdateId = await nextUpdateId();
    const callbackPayload = {
      update_id: callbackUpdateId,
      callback_query: {
        id: `phase2-${callbackUpdateId}`,
        from: telegramUser,
        message: {
          message_id: Number(orderPreviewReceipt.replyMessageId),
          chat: { id: privateChatId, type: 'private' },
        },
        data: `a:${pendingAction.id}:c`,
      },
    };
    await postUpdate({
      url: webhookEndpoint,
      bypassSecret: input.bypassSecret,
      telegramSecret,
      update: callbackPayload,
    });
    await waitForUpdate(callbackUpdateId);
    const executed = await prisma.aiPendingAction.findUniqueOrThrow({
      where: { id: pendingAction.id },
      select: { status: true, recordId: true },
    });
    if (executed.status !== 'EXECUTED' || !executed.recordId) {
      throw new Error('telegram_preview_order_not_executed');
    }

    const [order, receipt, orderCount] = await Promise.all([
      prisma.order.findUniqueOrThrow({
        where: { id: executed.recordId },
        include: { customer: true, lines: true },
      }),
      prisma.aiExecutionReceipt.findUniqueOrThrow({
        where: { pendingActionId: pendingAction.id },
        include: { documents: true, deliveries: true },
      }),
      prisma.order.count({ where: { notes: orderMarker } }),
    ]);
    if (orderCount !== 1 || order.lines.length !== 1 || order.lines[0].sku !== input.productSku) {
      throw new Error('telegram_preview_order_persistence_mismatch');
    }
    const customer = order.customer;
    if (
      !customer
      || (customer.nameEn !== customerName && customer.nameAr !== customerName)
      || !customer.phone?.replace(/\D/g, '').endsWith(runId)
      || customer.address1 !== address
      || customer.street !== street
    ) {
      throw new Error('telegram_preview_customer_persistence_mismatch');
    }
    if (receipt.channel !== 'TELEGRAM' || receipt.status !== 'COMPLETED') {
      throw new Error('telegram_preview_receipt_incomplete');
    }
    const document = receipt.documents[0];
    const delivery = receipt.deliveries[0];
    if (
      !document
      || document.status !== 'READY'
      || !document.content
      || document.content.byteLength < 1_000
      || Buffer.from(document.content).subarray(0, 4).toString('ascii') !== '%PDF'
    ) {
      throw new Error('telegram_preview_pdf_invalid');
    }
    if (!delivery || delivery.status !== 'DELIVERED' || !delivery.externalMessageId) {
      throw new Error('telegram_preview_pdf_not_delivered');
    }

    const duplicateCallback = await postUpdate({
      url: webhookEndpoint,
      bypassSecret: input.bypassSecret,
      telegramSecret,
      update: callbackPayload,
    });
    if (duplicateCallback.duplicate !== true) {
      throw new Error('telegram_preview_callback_duplicate_not_detected');
    }
    const [finalOrderCount, finalReceiptCount] = await Promise.all([
      prisma.order.count({ where: { notes: orderMarker } }),
      prisma.aiExecutionReceipt.count({ where: { pendingActionId: pendingAction.id } }),
    ]);
    if (finalOrderCount !== 1 || finalReceiptCount !== 1) {
      throw new Error('telegram_preview_duplicate_write_detected');
    }
    verificationComplete = true;
  } finally {
    try {
      if (identityRestore) {
        await prisma.telegramIdentity.update({
          where: { id: identityRestore.id },
          data: {
            userId: identityRestore.userId,
            status: identityRestore.status,
            revokedAt: identityRestore.revokedAt,
          },
        });
      }
    } finally {
      if (webhookChanged) {
        await restoreWebhook(telegramSecret, originalWebhook);
        const restored = await getTelegramWebhookInfo();
        if (restored.url !== originalWebhook.url) {
          throw new Error('telegram_preview_webhook_restore_failed');
        }
      }
    }
  }
  if (!verificationComplete) throw new Error('telegram_preview_verification_incomplete');
  return {
    botAuthentication: 'passed',
    webhookAuth: 'passed',
    privateChatOnly: 'passed',
    statusDelivery: 'passed',
    updateIdempotency: 'passed',
    orderCustomerAtomicity: 'passed',
    callbackIdempotency: 'passed',
    pdfPersistence: 'passed',
    telegramDocumentDelivery: 'passed',
    webhookRestoration: 'passed',
  };
}
