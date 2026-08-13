import 'server-only';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';

export type AiAssistantConfig = {
  enabled: boolean;
  model: string;
  maxRequestsPerMinute: number;
  historyRetentionDays: number;
  apiKeyConfigured: boolean;
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAiAssistantConfig(): AiAssistantConfig {
  return {
    enabled: process.env.AI_ASSISTANT_ENABLED === 'true',
    model: process.env.AI_ASSISTANT_MODEL || 'gpt-5.4-mini-2026-03-17',
    maxRequestsPerMinute: positiveInteger(process.env.AI_ASSISTANT_MAX_REQUESTS_PER_MINUTE, 10),
    historyRetentionDays: positiveInteger(process.env.AI_ASSISTANT_HISTORY_RETENTION_DAYS, 90),
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
  };
}

let client: OpenAI | null = null;

export function getOpenAiClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('ai_key_missing');
  client ??= new OpenAI({ apiKey: key, maxRetries: 1, timeout: 20_000 });
  return client;
}

export function aiSafetyIdentifier(userId: string): string {
  return createHash('sha256').update(`laheeb-ai:${userId}`).digest('hex').slice(0, 32);
}
