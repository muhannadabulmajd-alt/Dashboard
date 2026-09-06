import 'server-only';
import { timingSafeEqual } from 'node:crypto';

export type TelegramConfig = {
  enabled: boolean;
  token: string | null;
  webhookSecret: string | null;
  allowedUserIds: Set<string>;
  configured: boolean;
};

export function parseTelegramUserIds(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(/[\s,;]+/)
      .map((item) => item.trim())
      .filter((item) => /^\d+$/.test(item)),
  );
}

export function getTelegramConfig(): TelegramConfig {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
  return {
    enabled: process.env.TELEGRAM_BOT_ENABLED === 'true',
    token,
    webhookSecret,
    allowedUserIds: parseTelegramUserIds(process.env.TELEGRAM_ALLOWED_USER_IDS),
    configured: Boolean(token && webhookSecret),
  };
}

export function telegramSecretMatches(received: string | null, expected: string | null): boolean {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function requireTelegramConfig(): TelegramConfig & {
  token: string;
  webhookSecret: string;
  configured: true;
} {
  const config = getTelegramConfig();
  if (!config.enabled) throw new Error('telegram_disabled');
  if (!config.token || !config.webhookSecret) throw new Error('telegram_not_configured');
  return { ...config, token: config.token, webhookSecret: config.webhookSecret, configured: true };
}
