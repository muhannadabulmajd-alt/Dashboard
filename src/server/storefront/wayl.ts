import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { StorefrontConfig } from './config';

const WAYL_TIMEOUT_MS = 8_000;

const waylLinkSchema = z.object({
  referenceId: z.string().min(1),
  id: z.string().min(1),
  code: z.string().optional(),
  total: z.union([z.string(), z.number()]).transform(Number),
  currency: z.string(),
  paymentMethod: z.string().nullable().optional(),
  status: z.string().min(1),
  completedAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  url: z.string().url(),
  webhookUrl: z.string().url().optional(),
  redirectionUrl: z.string().url().optional(),
  linkExpiresIn: z.string().optional(),
});

const waylEnvelopeSchema = z.object({
  data: waylLinkSchema,
  message: z.string().optional(),
});

export type WaylLink = z.infer<typeof waylLinkSchema>;

export type CreateWaylLinkInput = {
  referenceId: string;
  total: number;
  lineItems: { label: string; amount: number; type: 'increase' | 'decrease' }[];
  webhookUrl: string;
  redirectionUrl: string;
  customParameter?: string;
  expiresIn?: string;
};

export class WaylClientError extends Error {
  constructor(
    readonly code: 'timeout' | 'network' | 'http' | 'invalid_response' | 'not_found',
    readonly status?: number,
  ) {
    super(code);
    this.name = 'WaylClientError';
  }
}

type WaylConfig = NonNullable<StorefrontConfig['wayl']>;

export class WaylClient {
  constructor(
    private readonly config: WaylConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WAYL_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'X-WAYL-AUTHENTICATION': this.config.token,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      });
      if (response.status === 404) throw new WaylClientError('not_found', 404);
      if (!response.ok) throw new WaylClientError('http', response.status);
      try {
        return await response.json();
      } catch {
        throw new WaylClientError('invalid_response', response.status);
      }
    } catch (error) {
      if (error instanceof WaylClientError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new WaylClientError('timeout');
      }
      throw new WaylClientError('network');
    } finally {
      clearTimeout(timeout);
    }
  }

  async verifyAuthentication(): Promise<void> {
    await this.request('/api/v1/verify-auth-key');
  }

  async getPaymentLink(referenceId: string): Promise<WaylLink> {
    const payload = await this.request(`/api/v1/links/${encodeURIComponent(referenceId)}`);
    const parsed = waylEnvelopeSchema.safeParse(payload);
    if (!parsed.success) throw new WaylClientError('invalid_response');
    return parsed.data.data;
  }

  async createPaymentLink(input: CreateWaylLinkInput): Promise<WaylLink> {
    const requestBody = {
      env: this.config.environment,
      referenceId: input.referenceId,
      total: input.total,
      currency: 'IQD',
      customParameter: input.customParameter,
      lineItem: input.lineItems,
      webhookUrl: input.webhookUrl,
      webhookSecret: this.config.webhookSecret,
      redirectionUrl: input.redirectionUrl,
      linkExpiresIn: input.expiresIn ?? '1h',
    };
    try {
      const payload = await this.request('/api/v1/links', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });
      const parsed = waylEnvelopeSchema.safeParse(payload);
      if (!parsed.success) throw new WaylClientError('invalid_response');
      return parsed.data.data;
    } catch (error) {
      const uncertain = error instanceof WaylClientError &&
        (error.code === 'timeout' || error.code === 'network' || (error.code === 'http' && (error.status ?? 0) >= 500));
      if (!uncertain) throw error;
      try {
        const recovered = await this.getPaymentLink(input.referenceId);
        if (recovered.total !== input.total || recovered.currency !== 'IQD') {
          throw new WaylClientError('invalid_response');
        }
        return recovered;
      } catch (recoveryError) {
        if (recoveryError instanceof WaylClientError && recoveryError.code === 'not_found') throw error;
        throw recoveryError;
      }
    }
  }
}

function signatureBytes(value: string): Buffer | null {
  const normalized = value.trim().replace(/^sha256=/i, '');
  if (!/^[a-f\d]{64}$/i.test(normalized)) return null;
  return Buffer.from(normalized, 'hex');
}

export function verifyWaylWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const supplied = signatureBytes(signature);
  if (!supplied) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
