import { describe, expect, it } from 'vitest';
import {
  checkoutEventKey,
  classifyWaylStatus,
  storefrontCheckoutSchema,
  storefrontDeliveryZoneInputSchema,
  validIdempotencyKey,
  waylWebhookEventDisposition,
} from '@/server/storefront/contracts';

describe('storefront checkout validation', () => {
  it('accepts a complete guest checkout without trusting browser prices', () => {
    const parsed = storefrontCheckoutSchema.parse({
      lines: [{ sku: 'LHB-TEST', quantity: 2 }],
      quoteHash: 'a'.repeat(64),
      paymentMode: 'WAYL',
      locale: 'ar',
      customer: {
        name: 'زبون تجريبي',
        phone: '07701234567',
        governorate: 'BAGHDAD',
        address1: 'Baghdad',
      },
    });
    expect(parsed).not.toHaveProperty('total');
    expect(parsed.lines[0]).toEqual({ sku: 'LHB-TEST', quantity: 2 });
  });

  it('requires a stable high-entropy-looking idempotency key', () => {
    expect(validIdempotencyKey('checkout-20260824-123456')).toBe('checkout-20260824-123456');
    expect(validIdempotencyKey('short')).toBeNull();
  });
});

describe('delivery-zone input', () => {
  it('accepts a bilingual IQD zone and rejects negative fees', () => {
    expect(storefrontDeliveryZoneInputSchema.safeParse({
      code: 'BGD', nameEn: 'Baghdad', nameAr: 'بغداد', deliveryFee: '5000', minimumOrder: '0', sortOrder: '1',
    }).success).toBe(true);
    expect(storefrontDeliveryZoneInputSchema.safeParse({
      code: 'BGD', nameEn: 'Baghdad', nameAr: 'بغداد', deliveryFee: '-1', minimumOrder: '0', sortOrder: '1',
    }).success).toBe(false);
  });
});

describe('Wayl checkout reconciliation helpers', () => {
  it('maps only authoritative completion statuses to paid', () => {
    expect(classifyWaylStatus('Complete')).toBe('PAID');
    expect(classifyWaylStatus('Delivered')).toBe('PAID');
    expect(classifyWaylStatus('Processing')).toBe('PENDING');
    expect(classifyWaylStatus('Rejected')).toBe('FAILED');
    expect(classifyWaylStatus('Returned')).toBe('RETURNED');
    expect(classifyWaylStatus('SomethingNew')).toBe('UNKNOWN');
  });

  it('uses exact raw webhook bytes as the idempotency key', () => {
    expect(checkoutEventKey('{"status":"Complete"}')).not.toBe(checkoutEventKey('{"status": "Complete"}'));
  });

  it('retries technical failures but deduplicates completed or in-flight webhook events', () => {
    expect(waylWebhookEventDisposition(null)).toBe('new');
    expect(waylWebhookEventDisposition('FAILED')).toBe('retry');
    expect(waylWebhookEventDisposition('PROCESSING')).toBe('duplicate');
    expect(waylWebhookEventDisposition('SUCCEEDED')).toBe('duplicate');
    expect(waylWebhookEventDisposition('IGNORED')).toBe('duplicate');
  });
});
