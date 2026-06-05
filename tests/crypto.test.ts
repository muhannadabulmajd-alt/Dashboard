import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from '@/server/crypto';

describe('secret encryption', () => {
  it('round-trips a value', () => {
    const secret = 'shpat_live_token_abc123';
    const enc = encryptSecret(secret);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it('does not store the plaintext and uses a fresh IV each time', () => {
    const enc1 = encryptSecret('hello');
    const enc2 = encryptSecret('hello');
    expect(enc1).not.toContain('hello');
    expect(enc1).not.toBe(enc2); // random IV
    expect(decryptSecret(enc1)).toBe('hello');
    expect(decryptSecret(enc2)).toBe('hello');
  });
});
