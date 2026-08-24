import 'server-only';
import { z } from 'zod';

export type StorefrontRuntime = 'production' | 'preview' | 'development' | 'test';

export class StorefrontConfigError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Invalid storefront configuration (${code}).`);
    this.name = 'StorefrontConfigError';
    this.code = code;
  }
}

const exactOriginSchema = z.string().url().transform((value, ctx) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.pathname !== '/') {
    ctx.addIssue({ code: 'custom', message: 'Expected one exact HTTPS origin.' });
    return z.NEVER;
  }
  return url.origin;
});

type Environment = Readonly<Record<string, string | undefined>>;

function runtimeFromEnvironment(env: Environment): StorefrontRuntime {
  const value = env.VERCEL_ENV ?? env.NODE_ENV ?? 'development';
  if (value === 'production' || value === 'preview' || value === 'test') return value;
  return 'development';
}

function required(env: Environment, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new StorefrontConfigError(`missing_${key.toLowerCase()}`);
  return value;
}

export type StorefrontConfig = {
  enabled: boolean;
  runtime: StorefrontRuntime;
  apiKey?: string;
  origin?: string;
  wayl?: {
    token: string;
    baseUrl: 'https://api.thewayl.com';
    environment: 'test' | 'live';
    webhookSecret: string;
  };
};

const WAYL_API_BASE_URL = 'https://api.thewayl.com' as const;

export function readStorefrontConfig(env: Environment = process.env): StorefrontConfig {
  const enabled = env.STOREFRONT_ENABLED?.trim().toLowerCase() === 'true';
  const runtime = runtimeFromEnvironment(env);
  if (!enabled) return { enabled, runtime };

  const apiKey = required(env, 'STOREFRONT_API_KEY');
  if (apiKey.length < 32) throw new StorefrontConfigError('weak_storefront_api_key');

  const originResult = exactOriginSchema.safeParse(required(env, 'STOREFRONT_ORIGIN'));
  if (!originResult.success) throw new StorefrontConfigError('invalid_storefront_origin');

  const waylEnvironment = required(env, 'WAYL_ENV');
  const waylBaseUrl = required(env, 'WAYL_API_BASE_URL').replace(/\/$/, '');
  const isProduction = runtime === 'production';
  const expectedEnvironment = isProduction ? 'live' : 'test';

  if (waylEnvironment !== expectedEnvironment) {
    throw new StorefrontConfigError('wayl_environment_mismatch');
  }
  if (waylBaseUrl !== WAYL_API_BASE_URL) {
    throw new StorefrontConfigError('wayl_host_mismatch');
  }
  const webhookSecret = required(env, 'WAYL_WEBHOOK_SECRET');
  if (webhookSecret.length < 10 || webhookSecret.length > 255) {
    throw new StorefrontConfigError('invalid_wayl_webhook_secret');
  }

  return {
    enabled,
    runtime,
    apiKey,
    origin: originResult.data,
    wayl: {
      token: required(env, 'WAYL_API_TOKEN'),
      baseUrl: WAYL_API_BASE_URL,
      environment: expectedEnvironment,
      webhookSecret,
    },
  };
}

export function requireStorefrontConfig(env: Environment = process.env): StorefrontConfig & {
  enabled: true;
  apiKey: string;
  origin: string;
  wayl: NonNullable<StorefrontConfig['wayl']>;
} {
  const config = readStorefrontConfig(env);
  if (!config.enabled || !config.apiKey || !config.origin || !config.wayl) {
    throw new StorefrontConfigError('storefront_disabled');
  }
  return config as StorefrontConfig & {
    enabled: true;
    apiKey: string;
    origin: string;
    wayl: NonNullable<StorefrontConfig['wayl']>;
  };
}
