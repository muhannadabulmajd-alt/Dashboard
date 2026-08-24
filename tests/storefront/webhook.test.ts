import { describe, expect, it } from 'vitest';
import {
  checkoutEventKey,
  waylWebhookReference,
  waylWebhookStatus,
} from '@/server/storefront/contracts';

describe('Wayl webhook payload parsing', () => {
  it('finds a top-level reference without accepting unrelated values', () => {
    expect(waylWebhookReference({ referenceId: 'LHB-1', orderId: 'wrong' })).toBe('LHB-1');
  });

  it('accepts Wayl data envelopes', () => {
    expect(waylWebhookReference({ data: { referenceId: 'LHB-2' } })).toBe('LHB-2');
    expect(waylWebhookReference({ data: { id: 'not-a-reference' } })).toBeNull();
  });

  it('reads the documented paymentStatus callback field', () => {
    expect(waylWebhookStatus({ paymentStatus: 'Complete' })).toBe('Complete');
    expect(waylWebhookStatus({ data: { paymentStatus: 'Processing' } })).toBe('Processing');
  });

  it('deduplicates the same Wayl event ID even if JSON formatting changes', () => {
    expect(checkoutEventKey('{"id":"event-1"}', 'event-1'))
      .toBe(checkoutEventKey('{ "id": "event-1" }', 'event-1'));
    expect(checkoutEventKey('{"id":"event-1"}'))
      .not.toBe(checkoutEventKey('{ "id": "event-1" }'));
  });
});
