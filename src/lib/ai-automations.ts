import { addDays, format } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { z } from 'zod';
import { TZ } from '@/lib/dates';

export const AI_AUTOMATION_KINDS = [
  'DAILY_SUMMARY',
  'ANOMALY_ALERT',
  'REORDER_RECOMMENDATION',
  'DEMAND_FORECAST',
] as const;

export type AiAutomationKindValue = typeof AI_AUTOMATION_KINDS[number];
export type AiAutomationChannel = 'WEB' | 'TELEGRAM';

export const AiAutomationPreferenceInputSchema = z.object({
  kind: z.enum(AI_AUTOMATION_KINDS),
  enabled: z.boolean(),
  locale: z.enum(['ar', 'en']),
  channel: z.enum(['WEB', 'TELEGRAM']),
  deliveryHour: z.number().int().min(0).max(23),
  limit: z.number().int().min(1).max(50).optional(),
  lookbackDays: z.number().int().min(14).max(180).optional(),
  horizonDays: z.number().int().min(1).max(90).optional(),
  expiryDays: z.number().int().min(1).max(180).optional(),
}).strict();

export type AiAutomationPreferenceInput = z.infer<typeof AiAutomationPreferenceInputSchema>;

export type AiAutomationSettings = {
  deliveryHour: number;
  limit: number;
  lookbackDays?: number;
  horizonDays?: number;
  expiryDays?: number;
};

const DEFAULTS: Record<AiAutomationKindValue, AiAutomationSettings> = {
  DAILY_SUMMARY: { deliveryHour: 8, limit: 10 },
  ANOMALY_ALERT: { deliveryHour: 9, limit: 25, expiryDays: 30 },
  REORDER_RECOMMENDATION: { deliveryHour: 9, limit: 25, horizonDays: 30 },
  DEMAND_FORECAST: { deliveryHour: 9, limit: 25, lookbackDays: 60, horizonDays: 30 },
};

export function defaultAutomationSettings(kind: AiAutomationKindValue): AiAutomationSettings {
  return { ...DEFAULTS[kind] };
}

export function normalizeAutomationSettings(input: AiAutomationPreferenceInput): AiAutomationSettings {
  const defaults = defaultAutomationSettings(input.kind);
  const common = {
    deliveryHour: input.deliveryHour,
    limit: input.limit ?? defaults.limit,
  };
  if (input.kind === 'ANOMALY_ALERT') {
    return { ...common, expiryDays: input.expiryDays ?? defaults.expiryDays };
  }
  if (input.kind === 'REORDER_RECOMMENDATION') {
    return { ...common, horizonDays: input.horizonDays ?? defaults.horizonDays };
  }
  if (input.kind === 'DEMAND_FORECAST') {
    return {
      ...common,
      lookbackDays: input.lookbackDays ?? defaults.lookbackDays,
      horizonDays: input.horizonDays ?? defaults.horizonDays,
    };
  }
  return common;
}

/** Return the next daily execution instant for a Baghdad-local hour. */
export function nextAutomationRunAt(deliveryHour: number, from = new Date()): Date {
  const localNow = toZonedTime(from, TZ);
  const time = `${String(deliveryHour).padStart(2, '0')}:07:00.000`;
  const today = format(localNow, 'yyyy-MM-dd');
  const candidate = fromZonedTime(`${today}T${time}`, TZ);
  if (candidate.getTime() > from.getTime()) return candidate;
  const tomorrow = format(addDays(localNow, 1), 'yyyy-MM-dd');
  return fromZonedTime(`${tomorrow}T${time}`, TZ);
}

export function automationSlotKey(preferenceId: string, scheduledFor: Date): string {
  return `ai-automation:${preferenceId}:${scheduledFor.toISOString()}`;
}

export function automationToolRequest(kind: AiAutomationKindValue, settings: AiAutomationSettings): {
  name: 'sales_summary' | 'operational_alerts' | 'inventory_recommendations' | 'demand_forecast';
  arguments: Record<string, unknown>;
} {
  if (kind === 'DAILY_SUMMARY') {
    return {
      name: 'sales_summary',
      arguments: { range: { preset: 'today', from: null, to: null }, dimension: 'NONE' },
    };
  }
  if (kind === 'ANOMALY_ALERT') {
    return {
      name: 'operational_alerts',
      arguments: { expiryDays: settings.expiryDays ?? 30, limit: settings.limit },
    };
  }
  if (kind === 'REORDER_RECOMMENDATION') {
    return {
      name: 'inventory_recommendations',
      arguments: { query: null, horizonDays: settings.horizonDays ?? 30, limit: settings.limit },
    };
  }
  return {
    name: 'demand_forecast',
    arguments: {
      lookbackDays: settings.lookbackDays ?? 60,
      horizonDays: settings.horizonDays ?? 30,
      limit: settings.limit,
    },
  };
}

export function automationTitle(kind: AiAutomationKindValue, locale: 'ar' | 'en'): string {
  const titles: Record<AiAutomationKindValue, { ar: string; en: string }> = {
    DAILY_SUMMARY: { en: 'Scheduled daily sales summary', ar: 'ملخص المبيعات اليومي المجدول' },
    ANOMALY_ALERT: { en: 'Scheduled operational alerts', ar: 'التنبيهات التشغيلية المجدولة' },
    REORDER_RECOMMENDATION: { en: 'Scheduled reorder recommendations', ar: 'توصيات إعادة الطلب المجدولة' },
    DEMAND_FORECAST: { en: 'Scheduled demand forecast', ar: 'توقع الطلب المجدول' },
  };
  return titles[kind][locale];
}
