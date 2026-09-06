import { randomInt } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type TelegramWebhookInfo = {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  max_connections?: number;
  allowed_updates?: string[];
};

type TelegramBot = {
  id: number;
  is_bot: boolean;
};

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  error_code?: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name.toLowerCase()}_missing`);
  return value;
}

function requireSafeTarget(): {
  previewUrl: URL;
  bypassSecret: string;
  telegramToken: string;
  telegramSecret: string;
} {
  if (process.env.AI_PHASE2_DATABASE_ISOLATED !== 'true') {
    throw new Error('telegram_preview_requires_isolated_database');
  }
  const databaseUrl = new URL(requiredEnv('DATABASE_URL'));
  const expectedHost = requiredEnv('AI_PHASE2_EXPECTED_DB_HOST');
  if (databaseUrl.hostname !== expectedHost || !databaseUrl.hostname.endsWith('.neon.tech')) {
    throw new Error('telegram_preview_database_identity_mismatch');
  }
  const previewUrl = new URL(requiredEnv('AI_PHASE2_PREVIEW_URL'));
  if (
    previewUrl.protocol !== 'https:'
    || !previewUrl.hostname.endsWith('.vercel.app')
    || previewUrl.hostname === 'dashboard.laheeb.coffee'
  ) {
    throw new Error('telegram_preview_target_invalid');
  }
  if (process.env.TELEGRAM_BOT_ENABLED !== 'true') throw new Error('telegram_preview_bot_disabled');
  return {
    previewUrl,
    bypassSecret: requiredEnv('AI_PHASE2_VERCEL_BYPASS_SECRET'),
    telegramToken: requiredEnv('TELEGRAM_BOT_TOKEN'),
    telegramSecret: requiredEnv('TELEGRAM_WEBHOOK_SECRET'),
  };
}

async function telegramRequest<T>(
  token: string,
  method: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null) as TelegramResponse<T> | null;
  if (!response.ok || !body?.ok || body.result === undefined) {
    throw new Error(`telegram_preview_${method.toLowerCase()}_${body?.error_code ?? response.status}`);
  }
  return body.result;
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
    if (update?.status === 'IGNORED') throw new Error(`telegram_preview_update_ignored_${update.errorCode ?? 'unknown'}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('telegram_preview_update_timeout');
}

async function restoreWebhook(
  token: string,
  secret: string,
  original: TelegramWebhookInfo,
): Promise<void> {
  if (!original.url) {
    await telegramRequest<boolean>(token, 'deleteWebhook', { drop_pending_updates: false });
    return;
  }
  const payload: Record<string, unknown> = {
    url: original.url,
    secret_token: secret,
    drop_pending_updates: false,
  };
  if (original.max_connections) payload.max_connections = original.max_connections;
  if (original.allowed_updates?.length) payload.allowed_updates = original.allowed_updates;
  await telegramRequest<boolean>(token, 'setWebhook', payload);
}

async function main(): Promise<void> {
  const { previewUrl, bypassSecret, telegramToken, telegramSecret } = requireSafeTarget();
  const e2eEmail = requiredEnv('AI_PHASE2_E2E_EMAIL');
  const productSku = requiredEnv('AI_PHASE2_E2E_PRODUCT_SKU');
  const runId = requiredEnv('AI_PHASE2_E2E_RUN_ID').replace(/\D/g, '').slice(-7).padStart(7, '3');
  const originalWebhook = await telegramRequest<TelegramWebhookInfo>(telegramToken, 'getWebhookInfo');
  const bot = await telegramRequest<TelegramBot>(telegramToken, 'getMe');
  if (!bot.is_bot || !Number.isSafeInteger(bot.id)) throw new Error('telegram_preview_bot_verification_failed');
  if (originalWebhook.has_custom_certificate) throw new Error('telegram_preview_custom_certificate_unsupported');
  if (originalWebhook.url && new URL(originalWebhook.url).hostname === 'dashboard.laheeb.coffee') {
    throw new Error('telegram_preview_bot_points_to_production');
  }

  const featureWebhook = new URL('/api/telegram/webhook', previewUrl);
  featureWebhook.searchParams.set('x-vercel-protection-bypass', bypassSecret);
  let webhookChanged = false;
  let verificationComplete = false;

  try {
    // The request can succeed remotely even if the response is lost, so restore on every outcome.
    webhookChanged = true;
    await telegramRequest<boolean>(telegramToken, 'setWebhook', {
      url: featureWebhook.toString(),
      secret_token: telegramSecret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    const registered = await telegramRequest<TelegramWebhookInfo>(telegramToken, 'getWebhookInfo');
    if (registered.url !== featureWebhook.toString()) throw new Error('telegram_preview_webhook_not_registered');

    const webhookEndpoint = new URL('/api/telegram/webhook', previewUrl);
    const rejectedId = await nextUpdateId();
    await postUpdate({
      url: webhookEndpoint,
      bypassSecret,
      telegramSecret: `${telegramSecret}-invalid`,
      expectedStatus: 401,
      update: { update_id: rejectedId },
    });

    const groupId = await nextUpdateId();
    const groupResult = await postUpdate({
      url: webhookEndpoint,
      bypassSecret,
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
        telegramUserId: true,
        privateChatId: true,
        firstName: true,
        lastName: true,
        username: true,
        languageCode: true,
      },
    });
    if (!identity?.privateChatId) throw new Error('telegram_preview_linked_identity_missing');
    const telegramUserId = Number(identity.telegramUserId);
    const privateChatId = Number(identity.privateChatId);
    if (!Number.isSafeInteger(telegramUserId) || !Number.isSafeInteger(privateChatId)) {
      throw new Error('telegram_preview_identity_invalid');
    }
    const e2eUser = await prisma.user.findUniqueOrThrow({
      where: { email: e2eEmail },
      select: { id: true },
    });
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
    await postUpdate({
      url: webhookEndpoint,
      bypassSecret,
      telegramSecret,
      update: {
        update_id: statusUpdateId,
        message: {
          message_id: statusUpdateId,
          from: telegramUser,
          chat: { id: privateChatId, type: 'private' },
          text: '/status',
        },
      },
    });
    const statusReceipt = await waitForUpdate(statusUpdateId);
    const duplicateStatus = await postUpdate({
      url: webhookEndpoint,
      bypassSecret,
      telegramSecret,
      update: {
        update_id: statusUpdateId,
        message: {
          message_id: statusUpdateId,
          from: telegramUser,
          chat: { id: privateChatId, type: 'private' },
          text: '/status',
        },
      },
    });
    if (duplicateStatus.duplicate !== true) throw new Error('telegram_preview_duplicate_not_detected');
    const duplicateReceipt = await prisma.telegramUpdate.findUniqueOrThrow({
      where: { updateId: String(statusUpdateId) },
      select: { attempts: true },
    });
    if (duplicateReceipt.attempts !== statusReceipt.attempts) throw new Error('telegram_preview_duplicate_reprocessed');

    const customerName = `Phase Two Telegram Customer ${runId}`;
    const phone = `+964770${runId}`;
    const address = `Baghdad Telegram District ${runId}`;
    const street = 'Street 14, building 2';
    const orderMarker = `phase2-telegram-${runId}`;
    const orderUpdateId = await nextUpdateId();
    await postUpdate({
      url: webhookEndpoint,
      bypassSecret,
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
            `Product: 1 x ${productSku}`,
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
    for (const expected of [customerName, runId, address, street, productSku, orderMarker]) {
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
      bypassSecret,
      telegramSecret,
      update: callbackPayload,
    });
    await waitForUpdate(callbackUpdateId);
    const executed = await prisma.aiPendingAction.findUniqueOrThrow({
      where: { id: pendingAction.id },
      select: { status: true, recordId: true },
    });
    if (executed.status !== 'EXECUTED' || !executed.recordId) throw new Error('telegram_preview_order_not_executed');

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
    if (orderCount !== 1 || order.lines.length !== 1 || order.lines[0].sku !== productSku) {
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
      bypassSecret,
      telegramSecret,
      update: callbackPayload,
    });
    if (duplicateCallback.duplicate !== true) throw new Error('telegram_preview_callback_duplicate_not_detected');
    const [finalOrderCount, finalReceiptCount] = await Promise.all([
      prisma.order.count({ where: { notes: orderMarker } }),
      prisma.aiExecutionReceipt.count({ where: { pendingActionId: pendingAction.id } }),
    ]);
    if (finalOrderCount !== 1 || finalReceiptCount !== 1) {
      throw new Error('telegram_preview_duplicate_write_detected');
    }

    verificationComplete = true;
  } finally {
    if (webhookChanged) {
      await restoreWebhook(telegramToken, telegramSecret, originalWebhook);
      const restored = await telegramRequest<TelegramWebhookInfo>(telegramToken, 'getWebhookInfo');
      if (restored.url !== originalWebhook.url) throw new Error('telegram_preview_webhook_restore_failed');
    }
  }
  if (!verificationComplete) throw new Error('telegram_preview_verification_incomplete');
  process.stdout.write(JSON.stringify({
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
  }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'telegram_preview_verification_failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
