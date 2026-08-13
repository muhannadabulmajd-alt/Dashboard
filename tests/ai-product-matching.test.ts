import { describe, expect, it } from 'vitest';
import { rankProductCandidates, type ProductMatchDocument } from '@/lib/product-matching';

const products: ProductMatchDocument[] = [
  {
    id: 'cardamom',
    sku: 'LHB-TRK-CRD-225-TG-MD',
    barcodeValue: 'LHB000031',
    retailBarcode: '290000000032',
    nameEn: 'Turkish coffee with cardamom',
    nameAr: 'قهوة تركية وسط بالهيل',
    aliases: [],
    sizeGrams: 225,
    sizeLabel: '225',
    grind: 'TURKISH',
    roastLevel: 'MEDIUM',
    origin: null,
    productLine: 'TURKISH',
    variationType: null,
    sellUnit: 'unit',
    group: { code: 'PG-TRK', nameEn: 'Turkish Coffee', nameAr: 'قهوة تركية' },
  },
  {
    id: 'plain',
    sku: 'LHB-TRK-PLN-225-TG-MD',
    barcodeValue: 'LHB000030',
    retailBarcode: '290000000025',
    nameEn: 'Turkish Coffee - Plain',
    nameAr: 'قهوة تركية سادة',
    aliases: [],
    sizeGrams: 225,
    sizeLabel: '225',
    grind: 'TURKISH',
    roastLevel: 'MEDIUM',
    origin: null,
    productLine: 'TURKISH',
    variationType: null,
    sellUnit: 'unit',
    group: { code: 'PG-TRK', nameEn: 'Turkish Coffee', nameAr: 'قهوة تركية' },
  },
];

describe('AI product matching', () => {
  it('resolves exact identifiers', () => {
    expect(rankProductCandidates(products, 'LHB-TRK-CRD-225-TG-MD')).toMatchObject({ kind: 'exact', value: { id: 'cardamom' } });
    expect(rankProductCandidates(products, '290000000032')).toMatchObject({ kind: 'exact', value: { id: 'cardamom' } });
  });

  it('resolves composite natural wording across name, size, and variation fields', () => {
    expect(rankProductCandidates(products, 'Turkish coffee blend with cardamom 225 gram')).toMatchObject({ kind: 'exact', value: { id: 'cardamom' } });
    expect(rankProductCandidates(products, 'قهوة تركية وسط بالهيل ٢٢٥ غرام')).toMatchObject({ kind: 'exact', value: { id: 'cardamom' } });
  });

  it('keeps underspecified product families ambiguous', () => {
    const result = rankProductCandidates(products, 'Turkish coffee 225');
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.candidates.map((product) => product.id)).toEqual(expect.arrayContaining(['cardamom', 'plain']));
  });

  it('uses aliases as part of a composite product document', () => {
    const aliased = products.map((product) => product.id === 'cardamom' ? { ...product, aliases: ['Iraqi Turkish'] } : product);
    expect(rankProductCandidates(aliased, 'Iraqi Turkish cardamom 225')).toMatchObject({ kind: 'exact', value: { id: 'cardamom' } });
  });
});
