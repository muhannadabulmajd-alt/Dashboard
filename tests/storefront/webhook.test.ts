import { describe, expect, it } from 'vitest';
import { waylWebhookReference } from '@/server/storefront/contracts';

describe('Wayl webhook payload parsing', () => {
  it('finds a top-level reference without accepting unrelated values', () => {
    expect(waylWebhookReference({ referenceId: 'LHB-1', orderId: 'wrong' })).toBe('LHB-1');
  });

  it('accepts Wayl data envelopes', () => {
    expect(waylWebhookReference({ data: { referenceId: 'LHB-2' } })).toBe('LHB-2');
    expect(waylWebhookReference({ data: { id: 'not-a-reference' } })).toBeNull();
  });
});
