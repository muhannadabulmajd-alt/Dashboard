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
import {
  PRODUCT_LABEL_DETAILS_PERCENT,
  productLabelPdfLineHeight,
  productLabelTypography,
  softWrapLabelText,
} from '@/lib/product-label-layout';

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

  it('keeps the label details column within the requested 30-40% range', () => {
    expect(PRODUCT_LABEL_DETAILS_PERCENT).toBeGreaterThanOrEqual(30);
    expect(PRODUCT_LABEL_DETAILS_PERCENT).toBeLessThanOrEqual(40);
  });

  it('shrinks dense label text without clipping its content', () => {
    const compact = productLabelTypography({
      mainName: 'Laheeb Cups',
      variationName: 'Standard five cups',
      specItems: [{ label: 'Pack', value: '5 pieces' }],
    });
    const dense = productLabelTypography({
      mainName: 'Extra long premium coffee preparation product name for retail',
      variationName: 'Extra long variation name for the complete package',
      specItems: Array.from({ length: 5 }, (_, index) => ({
        label: `Specification ${index + 1}`,
        value: 'Detailed value',
      })),
    });

    expect(dense.titlePt).toBeLessThan(compact.titlePt);
    expect(dense.variationPt).toBeLessThan(compact.variationPt);
    expect(dense.specsPt).toBeLessThan(compact.specsPt);
    expect(softWrapLabelText('ExtraordinarilyLongProductName')).not.toContain('…');
    expect(softWrapLabelText('ExtraordinarilyLongProductName')).toContain('\u200B');
  });

  it('gives wrapped PDF label text enough line height to remain legible', () => {
    expect(productLabelPdfLineHeight(4.5, 1.28)).toBeGreaterThan(4.5);
    expect(productLabelPdfLineHeight(8.8, 1.12)).toBeGreaterThan(8.8);
  });
});
