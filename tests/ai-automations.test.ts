import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiAutomationPreferenceInputSchema,
  automationSlotKey,
  automationToolRequest,
  nextAutomationRunAt,
  normalizeAutomationSettings,
} from '@/lib/ai-automations';
import { isCronAuthorized } from '@/server/http/cron';

const state = vi.hoisted(() => ({
  notificationStatus: 'PENDING' as 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'SKIPPED',
  payload: {
    preferenceId: 'pref-1',
    scheduledFor: '2026-09-05T05:07:00.000Z',
    origin: 'https://preview.example',
  } as Record<string, unknown>,
  executeCount: 0,
  messageCount: 0,
}));

const executeAssistantTool = vi.hoisted(() => vi.fn(async () => {
  state.executeCount += 1;
  return {
    modelOutput: { status: 'ok' },
    events: [{
      type: 'result_card' as const,
      card: {
        title: 'Daily sales summary',
        generatedAt: '2026-09-05T05:07:00.000Z',
        reportId: 'report-1',
        downloads: [{ format: 'PDF' as const, href: '/api/ai-assistant/reports/report-1/pdf' }],
      },
    }],
  };
}));

vi.mock('@/server/db/client', () => ({
  prisma: {
    telegramIdentity: { findFirst: vi.fn(async () => null) },
    aiAutomationPreference: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      upsert: vi.fn(),
      findMany: vi.fn(async () => []),
    },
    aiNotificationLog: {
      upsert: vi.fn(async () => ({
        id: 'notification-1',
        status: state.notificationStatus,
        payload: state.payload,
      })),
      updateMany: vi.fn(async (input: { where?: { status?: unknown }; data?: { status?: typeof state.notificationStatus } }) => {
        if (input.where?.status === 'PROCESSING') return { count: 0 };
        if (!['PENDING', 'FAILED'].includes(state.notificationStatus)) return { count: 0 };
        state.notificationStatus = input.data?.status ?? 'PROCESSING';
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => ({ id: 'notification-1', payload: state.payload })),
      findUnique: vi.fn(async () => ({ attempts: 1 })),
      update: vi.fn(async (input: { data?: { status?: typeof state.notificationStatus; payload?: Record<string, unknown> } }) => {
        if (input.data?.status) state.notificationStatus = input.data.status;
        if (input.data?.payload) state.payload = input.data.payload;
        return { id: 'notification-1', status: state.notificationStatus, payload: state.payload };
      }),
    },
    aiMessage: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (input: unknown) => {
      if (typeof input === 'function') {
        return (input as (client: unknown) => Promise<unknown>)({});
      }
      return Promise.all(input as Promise<unknown>[]);
    }),
  },
}));

vi.mock('@/server/ai/history', () => ({
  getOrCreateConversation: vi.fn(async () => ({ id: 'conversation-1' })),
  saveAiMessage: vi.fn(async (input: { role: string }) => {
    state.messageCount += 1;
    return { id: input.role === 'SYSTEM' ? 'source-1' : 'assistant-1', conversationId: 'conversation-1' };
  }),
}));
vi.mock('@/server/ai/tools', () => ({ executeAssistantTool }));
vi.mock('@/server/ai/reports', () => ({ deliverAiReportsToTelegram: vi.fn(async () => undefined) }));
vi.mock('@/server/telegram/api', () => ({ sendTelegramMessage: vi.fn(async () => ({ message_id: 1 })) }));
vi.mock('@/server/telegram/render', () => ({ renderAssistantEvents: vi.fn(() => ({ chunks: ['summary'] })) }));

import { processAiAutomationPreference, saveAiAutomationPreference } from '@/server/ai/automations';

const user = {
  id: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  role: 'OWNER' as const,
  branchId: null,
  defaultFinanceAccountId: null,
  isActive: true,
  telegramIdentity: null,
};

const preference = {
  id: 'pref-1',
  userId: user.id,
  kind: 'DAILY_SUMMARY' as const,
  enabled: true,
  locale: 'en',
  channel: 'WEB' as const,
  settings: { deliveryHour: 8, limit: 10 },
  nextRunAt: new Date('2026-09-05T05:07:00.000Z'),
  user,
};

afterEach(() => {
  state.notificationStatus = 'PENDING';
  state.payload = {
    preferenceId: 'pref-1',
    scheduledFor: '2026-09-05T05:07:00.000Z',
    origin: 'https://preview.example',
  };
  state.executeCount = 0;
  state.messageCount = 0;
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('AI automation contracts', () => {
  it('validates bounded settings and discards fields irrelevant to the selected automation', () => {
    const input = AiAutomationPreferenceInputSchema.parse({
      kind: 'DAILY_SUMMARY',
      enabled: true,
      locale: 'ar',
      channel: 'WEB',
      deliveryHour: 8,
      lookbackDays: 90,
    });
    expect(normalizeAutomationSettings(input)).toEqual({ deliveryHour: 8, limit: 10 });
    expect(() => AiAutomationPreferenceInputSchema.parse({ ...input, deliveryHour: 24 })).toThrow();
    expect(() => AiAutomationPreferenceInputSchema.parse({ ...input, sql: 'select *' })).toThrow();
  });

  it('schedules against Baghdad local time and advances to tomorrow after the slot', () => {
    expect(nextAutomationRunAt(8, new Date('2026-09-05T04:00:00.000Z')).toISOString())
      .toBe('2026-09-05T05:07:00.000Z');
    expect(nextAutomationRunAt(8, new Date('2026-09-05T06:00:00.000Z')).toISOString())
      .toBe('2026-09-06T05:07:00.000Z');
  });

  it('requires the exact server-only cron bearer secret', () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret-value');
    const request = (authorization: string | null) => ({
      headers: new Headers(authorization ? { authorization } : {}),
    });
    expect(isCronAuthorized(request('Bearer cron-secret-value'))).toBe(true);
    expect(isCronAuthorized(request('Bearer cron-secret-value-extra'))).toBe(false);
    expect(isCronAuthorized(request(null))).toBe(false);
  });

  it('maps each schedule to an existing read-only governed tool', () => {
    expect(automationToolRequest('DAILY_SUMMARY', { deliveryHour: 8, limit: 10 }).name).toBe('sales_summary');
    expect(automationToolRequest('ANOMALY_ALERT', { deliveryHour: 9, limit: 20, expiryDays: 14 }))
      .toEqual({ name: 'operational_alerts', arguments: { expiryDays: 14, limit: 20 } });
    expect(automationToolRequest('REORDER_RECOMMENDATION', { deliveryHour: 9, limit: 20, horizonDays: 21 }).name)
      .toBe('inventory_recommendations');
    expect(automationToolRequest('DEMAND_FORECAST', { deliveryHour: 9, limit: 20, lookbackDays: 60, horizonDays: 30 }).name)
      .toBe('demand_forecast');
  });

  it('uses one durable execution for a duplicated cron slot', async () => {
    const now = new Date('2026-09-05T05:08:00.000Z');
    expect(automationSlotKey(preference.id, preference.nextRunAt)).toBe(
      'ai-automation:pref-1:2026-09-05T05:07:00.000Z',
    );
    await expect(processAiAutomationPreference({ preference, origin: 'https://preview.example', now }))
      .resolves.toBe('SENT');
    await expect(processAiAutomationPreference({ preference, origin: 'https://preview.example', now }))
      .resolves.toBe('SENT');
    expect(executeAssistantTool).toHaveBeenCalledOnce();
    expect(state.executeCount).toBe(1);
    expect(state.messageCount).toBe(2);
  });

  it('refuses an enabled Telegram schedule without an active linked private chat', async () => {
    await expect(saveAiAutomationPreference({
      user,
      value: {
        kind: 'DAILY_SUMMARY',
        enabled: true,
        locale: 'en',
        channel: 'TELEGRAM',
        deliveryHour: 8,
      },
    })).rejects.toThrow('telegram_not_linked');
  });
});
