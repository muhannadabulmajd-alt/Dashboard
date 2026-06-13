import { describe, expect, it } from 'vitest';
import { parseDecimalInput, decimalString } from '@/lib/decimal';

describe('decimal helpers', () => {
  it('accepts up to three decimal places', () => {
    expect(parseDecimalInput('0.001')).toBe(0.001);
    expect(parseDecimalInput('25.000')).toBe(25);
    expect(parseDecimalInput('1.2345')).toBeNull();
  });

  it('formats stable three-decimal strings for persistence', () => {
    expect(decimalString(1.2)).toBe('1.200');
  });
});
