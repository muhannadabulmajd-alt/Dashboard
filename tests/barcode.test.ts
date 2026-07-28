import { describe, expect, it } from 'vitest';
import {
  barcodeModuleCount,
  encodeCode128B,
  encodeEan13,
  ean13CheckDigit,
  formatProductBarcode,
  formatRetailBarcode,
  isValidEan13,
  isValidRetailBarcode,
  parseProductBarcodeSequence,
  parseRetailBarcodeSequence,
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

  it('creates deterministic internal EAN-13 values with valid check digits', () => {
    expect(formatRetailBarcode(1)).toBe('2900000000018');
    expect(formatRetailBarcode(123)).toBe('2900000001237');
    expect(ean13CheckDigit('290000000001')).toBe(8);
    expect(isValidEan13('2900000000018')).toBe(true);
    expect(isValidRetailBarcode('2900000000018')).toBe(true);
    expect(isValidRetailBarcode('4006381333931')).toBe(false);
    expect(isValidEan13('2900000000017')).toBe(false);
    expect(parseRetailBarcodeSequence('2900000001237')).toBe(123);
    expect(parseRetailBarcodeSequence('5901234123457')).toBeNull();
  });

  it('encodes EAN-13 into 95 modules with extended guard bars', () => {
    const modules = encodeEan13('2900000000018');
    expect(modules).toHaveLength(95);
    expect(modules.filter((module) => module.guard).map((module) => module.index)).toEqual([0, 2, 46, 48, 92, 94]);
    expect(modules[0]).toMatchObject({ bar: true, guard: true });
    expect(modules[1]).toMatchObject({ bar: false, guard: false });
  });

  it('rejects invalid retail barcode sequences and check digits', () => {
    expect(() => formatRetailBarcode(0)).toThrow();
    expect(() => formatRetailBarcode(1_000_000_000)).toThrow();
    expect(() => encodeEan13('2900000000017')).toThrow();
  });
});
