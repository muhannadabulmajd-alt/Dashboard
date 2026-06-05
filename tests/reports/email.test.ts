import { describe, it, expect, afterEach } from 'vitest';
import { emailProvider, parseRecipients } from '@/server/reports/email';

describe('email helpers', () => {
  const orig = process.env.RESEND_API_KEY;
  afterEach(() => {
    if (orig === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = orig;
  });

  it('parseRecipients splits, trims, and drops blanks', () => {
    expect(parseRecipients('a@x.com, b@y.com ,')).toEqual(['a@x.com', 'b@y.com']);
    expect(parseRecipients(undefined)).toEqual([]);
    expect(parseRecipients('')).toEqual([]);
  });

  it('emailProvider uses resend only when a key is set', () => {
    delete process.env.RESEND_API_KEY;
    expect(emailProvider()).toBe('log');
    process.env.RESEND_API_KEY = 'rk_test';
    expect(emailProvider()).toBe('resend');
  });
});
