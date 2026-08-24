import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createWaylLinkInputSchema,
  WaylClient,
  WaylClientError,
  verifyWaylWebhookSignature,
} from '@/server/storefront/wayl';

const config = {
  token: 'wayl-test-token',
  baseUrl: 'https://api.thewayl.com' as const,
  environment: 'test' as const,
  webhookSecret: 'wayl-webhook-secret',
};

const link = {
  data: {
    referenceId: 'LHB-TEST-1',
    id: 'wayl-link-1',
    code: 'ABCD1234',
    total: '10000',
    currency: 'IQD',
    status: 'Created',
    url: 'https://pay.example.test/ABCD1234',
  },
};

describe('Wayl client', () => {
  it('uses the shared API host with the test environment and authentication header', async () => {
    const fetchImpl = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify(link), { status: 201 }),
    );
    const client = new WaylClient(config, fetchImpl as typeof fetch);
    const result = await client.createPaymentLink({
      referenceId: 'LHB-TEST-1',
      total: 10_000,
      lineItems: [{ label: 'Basket value', amount: 10_000, type: 'increase' }],
      webhookUrl: 'https://dashboard.example.test/api/storefront/v1/wayl/webhook',
      redirectionUrl: 'https://store.example.test/checkout/return',
    });
    expect(result.total).toBe(10_000);
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.thewayl.com/api/v1/links');
    expect((request?.headers as Record<string, string>)['X-WAYL-AUTHENTICATION']).toBe(config.token);
    expect(JSON.parse(String(request?.body))).toEqual({
      env: 'test',
      referenceId: 'LHB-TEST-1',
      total: 10_000,
      currency: 'IQD',
      customParameter: '',
      lineItem: [{ label: 'Basket value', amount: 10_000, type: 'increase' }],
      webhookUrl: 'https://dashboard.example.test/api/storefront/v1/wayl/webhook',
      webhookSecret: config.webhookSecret,
      redirectionUrl: 'https://store.example.test/checkout/return',
      linkExpiresIn: '1h',
    });
  });

  it('recovers an uncertain create by retrieving the same reference', async () => {
    const fetchImpl = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(new Response(JSON.stringify(link), { status: 200 }));
    const client = new WaylClient(config, fetchImpl as typeof fetch);
    const result = await client.createPaymentLink({
      referenceId: 'LHB-TEST-1',
      total: 10_000,
      lineItems: [{ label: 'Basket value', amount: 10_000, type: 'increase' }],
      webhookUrl: 'https://dashboard.example.test/api/storefront/v1/wayl/webhook',
      redirectionUrl: 'https://store.example.test/checkout/return',
    });
    expect(result.referenceId).toBe('LHB-TEST-1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry an explicitly rejected request', async () => {
    const fetchImpl = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response('{}', { status: 401 }),
    );
    const client = new WaylClient(config, fetchImpl as typeof fetch);
    await expect(client.createPaymentLink({
      referenceId: 'LHB-TEST-1',
      total: 10_000,
      lineItems: [{ label: 'Basket value', amount: 10_000, type: 'increase' }],
      webhookUrl: 'https://dashboard.example.test/api/storefront/v1/wayl/webhook',
      redirectionUrl: 'https://store.example.test/checkout/return',
    })).rejects.toMatchObject({ code: 'http', status: 401 } satisfies Partial<WaylClientError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed link requests before contacting Wayl', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new WaylClient(config, fetchImpl);
    await expect(client.createPaymentLink({
      referenceId: 'LHB-TEST-1',
      total: 10_000,
      lineItems: [{ label: 'Basket value', amount: 9_999, type: 'increase' }],
      webhookUrl: 'https://dashboard.example.test/api/storefront/v1/wayl/webhook',
      redirectionUrl: 'https://store.example.test/checkout/return',
    })).rejects.toMatchObject({ code: 'invalid_request' } satisfies Partial<WaylClientError>);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('enforces the documented total, URL, expiry, and line-item limits', () => {
    expect(createWaylLinkInputSchema.safeParse({
      referenceId: 'LHB-TEST-1',
      total: 999,
      lineItems: [{ label: 'ab', amount: 999, type: 'increase' }],
      webhookUrl: 'http://dashboard.example.test/webhook',
      redirectionUrl: 'https://store.example.test/return',
      expiresIn: '31d',
    }).success).toBe(false);
  });
});

describe('Wayl webhook signatures', () => {
  it('verifies the exact raw request bytes', () => {
    const body = '{"referenceId":"LHB-TEST-1","status":"Complete"}';
    const signature = createHmac('sha256', config.webhookSecret).update(body).digest('hex');
    expect(verifyWaylWebhookSignature(body, signature, config.webhookSecret)).toBe(true);
    expect(verifyWaylWebhookSignature(`${body}\n`, signature, config.webhookSecret)).toBe(false);
  });

  it('rejects malformed signatures', () => {
    expect(verifyWaylWebhookSignature('{}', 'not-a-signature', config.webhookSecret)).toBe(false);
  });
});
