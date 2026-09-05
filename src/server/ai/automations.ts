import 'server-only';

import type { AiAutomationKind, AiDeliveryChannel, Prisma } from '@prisma/client';
import type { AiStreamEvent } from '@/lib/ai-assistant';
import {
  AiAutomationPreferenceInputSchema,
  automationSlotKey,
  automationTitle,
  automationToolRequest,
  defaultAutomationSettings,
  nextAutomationRunAt,
  normalizeAutomationSettings,
  type AiAutomationPreferenceInput,
  type AiAutomationSettings,
} from '@/lib/ai-automations';
import type { CurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';
import { sendTelegramMessage } from '@/server/telegram/api';
import { renderAssistantEvents } from '@/server/telegram/render';
import { getOrCreateConversation, saveAiMessage } from './history';
import { deliverAiReportsToTelegram } from './reports';
import { executeAssistantTool } from './tools';

type StoredAutomationPayload = {
  preferenceId: string;
  scheduledFor: string;
  origin: string;
  sentChunkCount?: number;
  conversationId?: string;
  assistantMessageId?: string;
};

type AutomationPreferenceRecord = {
  id: string;
  userId: string;
  kind: AiAutomationKind;
  enabled: boolean;
  locale: string;
  channel: AiDeliveryChannel;
  settings: Prisma.JsonValue | null;
  nextRunAt: Date | null;
  user: {
    id: string;
    email: string;
    name: string;
    role: CurrentUser['role'];
    branchId: string | null;
    defaultFinanceAccountId: string | null;
    isActive: boolean;
    telegramIdentity: { privateChatId: string | null; status: string } | null;
  };
};

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function settingsFromJson(kind: AiAutomationKind, value: Prisma.JsonValue | null): AiAutomationSettings {
  const defaults = defaultAutomationSettings(kind);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const row = value as Record<string, unknown>;
  const number = (key: string, fallback: number, minimum: number, maximum: number) => {
    const candidate = row[key];
    return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= minimum && candidate <= maximum
      ? candidate
      : fallback;
  };
  return {
    deliveryHour: number('deliveryHour', defaults.deliveryHour, 0, 23),
    limit: number('limit', defaults.limit, 1, 50),
    ...(kind === 'ANOMALY_ALERT' ? { expiryDays: number('expiryDays', defaults.expiryDays ?? 30, 1, 180) } : {}),
    ...(kind === 'REORDER_RECOMMENDATION' ? { horizonDays: number('horizonDays', defaults.horizonDays ?? 30, 1, 90) } : {}),
    ...(kind === 'DEMAND_FORECAST' ? {
      lookbackDays: number('lookbackDays', defaults.lookbackDays ?? 60, 14, 180),
      horizonDays: number('horizonDays', defaults.horizonDays ?? 30, 1, 90),
    } : {}),
  };
}

function payloadFromJson(value: Prisma.JsonValue): StoredAutomationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ai_automation_payload_invalid');
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.preferenceId !== 'string'
    || typeof payload.scheduledFor !== 'string'
    || typeof payload.origin !== 'string'
  ) throw new Error('ai_automation_payload_invalid');
  return payload as StoredAutomationPayload;
}

function storedEvents(value: Prisma.JsonValue | null): AiStreamEvent[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const events = (value as { events?: unknown }).events;
  return Array.isArray(events) ? events as AiStreamEvent[] : [];
}

function currentUser(record: AutomationPreferenceRecord['user']): CurrentUser {
  return {
    id: record.id,
    email: record.email,
    name: record.name,
    role: record.role,
    branchId: record.branchId,
    defaultFinanceAccountId: record.defaultFinanceAccountId,
  };
}

export async function saveAiAutomationPreference(input: {
  user: CurrentUser;
  value: AiAutomationPreferenceInput;
  now?: Date;
}) {
  const value = AiAutomationPreferenceInputSchema.parse(input.value);
  const now = input.now ?? new Date();
  const settings = normalizeAutomationSettings(value);
  if (value.channel === 'TELEGRAM' && value.enabled) {
    const identity = await prisma.telegramIdentity.findFirst({
      where: { userId: input.user.id, status: 'ACTIVE', privateChatId: { not: null } },
      select: { id: true },
    });
    if (!identity) throw new Error('telegram_not_linked');
  }

  return prisma.$transaction(async (tx) => {
    if (value.enabled) {
      await tx.aiAutomationPreference.updateMany({
        where: { userId: input.user.id, kind: value.kind, channel: { not: value.channel }, enabled: true },
        data: { enabled: false, nextRunAt: null },
      });
    }
    const preference = await tx.aiAutomationPreference.upsert({
      where: { userId_kind_channel: { userId: input.user.id, kind: value.kind, channel: value.channel } },
      create: {
        userId: input.user.id,
        kind: value.kind,
        channel: value.channel,
        locale: value.locale,
        enabled: value.enabled,
        settings: inputJson(settings),
        nextRunAt: value.enabled ? nextAutomationRunAt(settings.deliveryHour, now) : null,
      },
      update: {
        locale: value.locale,
        enabled: value.enabled,
        settings: inputJson(settings),
        nextRunAt: value.enabled ? nextAutomationRunAt(settings.deliveryHour, now) : null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.user.id,
        action: 'AI_AUTOMATION_PREFERENCE_UPDATED',
        entity: 'AiAutomationPreference',
        entityId: preference.id,
        metadata: {
          kind: preference.kind,
          channel: preference.channel,
          enabled: preference.enabled,
          locale: preference.locale,
          deliveryHour: settings.deliveryHour,
        },
      },
    });
    return preference;
  });
}

export async function getAiAutomationPreferences(userId: string) {
  return prisma.aiAutomationPreference.findMany({
    where: { userId },
    orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      kind: true,
      enabled: true,
      locale: true,
      channel: true,
      settings: true,
      nextRunAt: true,
      lastRunAt: true,
      updatedAt: true,
    },
  });
}

async function advancePreference(preference: AutomationPreferenceRecord, scheduledFor: Date, now: Date): Promise<void> {
  const settings = settingsFromJson(preference.kind, preference.settings);
  await prisma.aiAutomationPreference.updateMany({
    where: { id: preference.id, nextRunAt: scheduledFor },
    data: { lastRunAt: now, nextRunAt: nextAutomationRunAt(settings.deliveryHour, now) },
  });
}

async function markSkipped(input: {
  notificationId: string;
  preference: AutomationPreferenceRecord;
  scheduledFor: Date;
  now: Date;
  code: string;
}): Promise<void> {
  await prisma.aiNotificationLog.update({
    where: { id: input.notificationId },
    data: { status: 'SKIPPED', errorCode: input.code, sentAt: input.now },
  });
  await advancePreference(input.preference, input.scheduledFor, input.now);
}

async function loadOrExecuteEvents(input: {
  notificationId: string;
  preference: AutomationPreferenceRecord;
  now: Date;
}): Promise<{ events: AiStreamEvent[]; conversationId: string; assistantMessageId: string }> {
  const resultRequestId = `automation-result:${input.notificationId}`;
  const existingResult = await prisma.aiMessage.findFirst({
    where: { requestId: resultRequestId, conversation: { userId: input.preference.userId } },
    select: { id: true, conversationId: true, payload: true },
  });
  if (existingResult) {
    return {
      events: storedEvents(existingResult.payload),
      conversationId: existingResult.conversationId,
      assistantMessageId: existingResult.id,
    };
  }

  const locale = input.preference.locale === 'ar' ? 'ar' : 'en';
  const chatId = input.preference.user.telegramIdentity?.privateChatId ?? undefined;
  const conversation = await getOrCreateConversation({
    userId: input.preference.userId,
    locale,
    firstMessage: automationTitle(input.preference.kind, locale),
    channel: input.preference.channel,
    externalThreadId: input.preference.channel === 'TELEGRAM'
      ? chatId
      : `automation:${input.preference.id}`,
  });
  const sourceRequestId = `automation-source:${input.notificationId}`;
  const existingSource = await prisma.aiMessage.findFirst({
    where: { requestId: sourceRequestId, conversationId: conversation.id },
  });
  const source = existingSource ?? await saveAiMessage({
    conversationId: conversation.id,
    role: 'SYSTEM',
    content: automationTitle(input.preference.kind, locale),
    requestId: sourceRequestId,
  });
  const settings = settingsFromJson(input.preference.kind, input.preference.settings);
  const request = automationToolRequest(input.preference.kind, settings);
  const result = await executeAssistantTool(request.name, request.arguments, {
    conversationId: conversation.id,
    sourceMessageId: source.id,
    recentUserMessages: [],
    user: currentUser(input.preference.user),
    locale,
    now: input.now,
  });
  const assistant = await saveAiMessage({
    conversationId: conversation.id,
    role: 'ASSISTANT',
    kind: 'RESULT',
    content: null,
    payload: inputJson({
      events: result.events,
      automation: {
        notificationId: input.notificationId,
        preferenceId: input.preference.id,
        scheduledFor: input.preference.nextRunAt?.toISOString(),
      },
    }),
    requestId: resultRequestId,
  });
  return { events: result.events, conversationId: conversation.id, assistantMessageId: assistant.id };
}

async function deliverTelegramAutomation(input: {
  notificationId: string;
  payload: StoredAutomationPayload;
  events: AiStreamEvent[];
  userId: string;
  chatId: string;
  locale: 'ar' | 'en';
  origin: string;
  messageId: string;
}): Promise<void> {
  const rendered = renderAssistantEvents(input.events, {
    locale: input.locale,
    origin: input.origin,
    messageId: input.messageId,
  });
  let sentChunkCount = input.payload.sentChunkCount ?? 0;
  for (let index = sentChunkCount; index < rendered.chunks.length; index += 1) {
    const sent = await sendTelegramMessage({
      chatId: input.chatId,
      text: rendered.chunks[index],
      keyboard: index === rendered.chunks.length - 1 ? rendered.keyboard : undefined,
    });
    sentChunkCount = index + 1;
    await prisma.aiNotificationLog.update({
      where: { id: input.notificationId },
      data: {
        externalMessageId: String(sent.message_id),
        payload: inputJson({ ...input.payload, sentChunkCount }),
      },
    });
  }
  await deliverAiReportsToTelegram({
    events: input.events,
    userId: input.userId,
    chatId: input.chatId,
    locale: input.locale,
    origin: input.origin,
  });
}

export async function processAiAutomationPreference(input: {
  preference: AutomationPreferenceRecord;
  origin: string;
  now?: Date;
}): Promise<'SENT' | 'SKIPPED' | 'IGNORED'> {
  const now = input.now ?? new Date();
  const scheduledFor = input.preference.nextRunAt;
  if (!input.preference.enabled || !scheduledFor || scheduledFor > now) return 'IGNORED';
  const idempotencyKey = automationSlotKey(input.preference.id, scheduledFor);
  const initialPayload: StoredAutomationPayload = {
    preferenceId: input.preference.id,
    scheduledFor: scheduledFor.toISOString(),
    origin: input.origin,
  };
  const notification = await prisma.aiNotificationLog.upsert({
    where: { idempotencyKey },
    create: {
      userId: input.preference.userId,
      kind: 'AI_AUTOMATION_RUN',
      channel: input.preference.channel,
      status: 'PENDING',
      payload: inputJson(initialPayload),
      idempotencyKey,
    },
    update: {},
  });
  if (notification.status === 'SENT' || notification.status === 'SKIPPED') {
    await advancePreference(input.preference, scheduledFor, now);
    return notification.status;
  }
  const staleAt = new Date(now.getTime() - 10 * 60_000);
  await prisma.aiNotificationLog.updateMany({
    where: { id: notification.id, status: 'PROCESSING', lastAttemptAt: { lt: staleAt } },
    data: { status: 'FAILED', errorCode: 'automation_interrupted', availableAt: now },
  });
  const claimed = await prisma.aiNotificationLog.updateMany({
    where: {
      id: notification.id,
      status: { in: ['PENDING', 'FAILED'] },
      availableAt: { lte: now },
    },
    data: { status: 'PROCESSING', attempts: { increment: 1 }, lastAttemptAt: now, errorCode: null },
  });
  if (claimed.count !== 1) return 'IGNORED';
  if (!input.preference.user.isActive) {
    await markSkipped({ notificationId: notification.id, preference: input.preference, scheduledFor, now, code: 'user_inactive' });
    return 'SKIPPED';
  }
  const chatId = input.preference.user.telegramIdentity?.status === 'ACTIVE'
    ? input.preference.user.telegramIdentity.privateChatId
    : null;
  if (input.preference.channel === 'TELEGRAM' && !chatId) {
    await markSkipped({ notificationId: notification.id, preference: input.preference, scheduledFor, now, code: 'telegram_not_linked' });
    return 'SKIPPED';
  }

  try {
    const execution = await loadOrExecuteEvents({
      notificationId: notification.id,
      preference: input.preference,
      now,
    });
    const current = await prisma.aiNotificationLog.findUniqueOrThrow({ where: { id: notification.id } });
    const payload = payloadFromJson(current.payload);
    const updatedPayload: StoredAutomationPayload = {
      ...payload,
      conversationId: execution.conversationId,
      assistantMessageId: execution.assistantMessageId,
    };
    await prisma.aiNotificationLog.update({
      where: { id: notification.id },
      data: { payload: inputJson(updatedPayload) },
    });
    if (input.preference.channel === 'TELEGRAM' && chatId) {
      await deliverTelegramAutomation({
        notificationId: notification.id,
        payload: updatedPayload,
        events: execution.events,
        userId: input.preference.userId,
        chatId,
        locale: input.preference.locale === 'ar' ? 'ar' : 'en',
        origin: input.origin,
        messageId: execution.assistantMessageId,
      });
    }
    await prisma.$transaction([
      prisma.aiNotificationLog.update({
        where: { id: notification.id },
        data: { status: 'SENT', sentAt: now, errorCode: null },
      }),
      prisma.aiAutomationPreference.updateMany({
        where: { id: input.preference.id, nextRunAt: scheduledFor },
        data: {
          lastRunAt: now,
          nextRunAt: nextAutomationRunAt(settingsFromJson(input.preference.kind, input.preference.settings).deliveryHour, now),
        },
      }),
    ]);
    return 'SENT';
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 120) : 'ai_automation_failed';
    if (errorCode === 'ai_tool_not_allowed') {
      await markSkipped({
        notificationId: notification.id,
        preference: input.preference,
        scheduledFor,
        now,
        code: errorCode,
      });
      return 'SKIPPED';
    }
    const row = await prisma.aiNotificationLog.findUnique({ where: { id: notification.id }, select: { attempts: true } });
    const attempts = row?.attempts ?? 1;
    await prisma.aiNotificationLog.update({
      where: { id: notification.id },
      data: {
        status: 'FAILED',
        errorCode,
        availableAt: new Date(now.getTime() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(attempts, 6))),
      },
    });
    throw error;
  }
}

export async function runDueAiAutomations(input: {
  origin: string;
  now?: Date;
  limit?: number;
}): Promise<{ due: number; sent: number; skipped: number; failed: number }> {
  const now = input.now ?? new Date();
  const preferences = await prisma.aiAutomationPreference.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
    take: input.limit ?? 25,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          branchId: true,
          defaultFinanceAccountId: true,
          isActive: true,
          telegramIdentity: { select: { privateChatId: true, status: true } },
        },
      },
    },
  });
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const preference of preferences) {
    try {
      const status = await processAiAutomationPreference({ preference, origin: input.origin, now });
      if (status === 'SENT') sent += 1;
      if (status === 'SKIPPED') skipped += 1;
    } catch (error) {
      failed += 1;
      console.error('AI automation failed', {
        preferenceId: preference.id,
        kind: preference.kind,
        errorCode: error instanceof Error ? error.message.slice(0, 120) : 'ai_automation_failed',
      });
    }
  }
  return { due: preferences.length, sent, skipped, failed };
}
