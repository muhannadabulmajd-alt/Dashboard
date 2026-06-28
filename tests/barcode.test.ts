import { describe, expect, it } from 'vitest';
import {
  barcodeModuleCount,
  encodeCode128B,
  formatProductBarcode,
  parseProductBarcodeSequence,
} from '@/lib/barcode';

describe('product barcode helpers', () => {
  it('formats short internal product barcode values', () => {
    expect(formatProductBarcode(1)).toBe('LHB000001');
    expect(formatProductBarcode(123)).toBe('LHB000123');
    expect(parseProductBarcodeSequence('LHB000123')).toBe(123);
    expect(parseProductBarcodeSequence('LHB-000123')).toBeNull();
  });

  it('encodes printable Code 128 subset B bars', () => {
    const bars = encodeCode128B('LHB000001');
    expect(bars.length).toBeGreaterThan(0);
    expect(barcodeModuleCount(bars)).toBeGreaterThan(90);
    expect(bars.some((bar) => bar.bar)).toBe(true);
  });

  it('rejects values that cannot be scanned as subset B', () => {
    expect(() => encodeCode128B('')).toThrow();
    expect(() => encodeCode128B('لهيب')).toThrow();
  });
});
