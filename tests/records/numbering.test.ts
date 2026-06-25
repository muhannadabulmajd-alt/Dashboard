import { describe, expect, it } from 'vitest';
import {
  channelCodeForOrderNumber,
  formatCustomerExternalId,
  formatOrderNumber,
  laheebDateKey,
} from '@/lib/numbering';

describe('Laheeb operational numbering', () => {
  const date = new Date('2026-06-25T07:00:00.000Z');

  it('formats Baghdad date keys and full order numbers', () => {
    expect(laheebDateKey(date)).toBe('260625');
    expect(formatOrderNumber(date, 'WHATSAPP', 1)).toBe('LHB-ORD-260625-WA-0001');
    expect(formatOrderNumber(date, 'INSTAGRAM', 23)).toBe('LHB-ORD-260625-IG-0023');
  });

  it('maps legacy and operational channels to short codes', () => {
    expect(channelCodeForOrderNumber('ONLINE_STORE')).toBe('WEB');
    expect(channelCodeForOrderNumber('SOCIAL')).toBe('WA');
    expect(channelCodeForOrderNumber('POS')).toBe('WIN');
    expect(channelCodeForOrderNumber('RESELLERS')).toBe('RSL');
    expect(channelCodeForOrderNumber('Gift')).toBe('GFT');
  });

  it('formats customer IDs with the matching date and sequence style', () => {
    expect(formatCustomerExternalId(date, 7)).toBe('LHB-CUS-260625-0007');
  });
});
