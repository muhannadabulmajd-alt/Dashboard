import { describe, it, expect } from 'vitest';
import { parseProducts, parseCustomers, parseBatches, parseOrders } from '@/server/ingestion/parsers';

describe('product parser', () => {
  const base = {
    sku: 'LH-ESP-X-250-WB',
    nameEn: 'Espresso X',
    nameAr: 'إسبريسو إكس',
    productLine: 'ESPRESSO',
    sizeLabel: '250g',
    sizeGrams: '250',
    grind: 'WHOLE_BEAN',
    roastLevel: 'MEDIUM',
    origin: 'Blend',
    sellingPrice: '13000',
    cogsPerUnit: '6000',
    active: 'Active',
  };

  it('parses a valid row and coerces numbers/booleans', () => {
    const { valid, errors } = parseProducts([base]);
    expect(errors).toHaveLength(0);
    expect(valid[0]).toMatchObject({ sku: 'LH-ESP-X-250-WB', sellingPrice: 13000, isActive: true });
  });

  it('rejects an invalid product line and reports the row', () => {
    const { valid, errors } = parseProducts([{ ...base, productLine: 'NOPE' }]);
    expect(valid).toHaveLength(0);
    expect(errors[0].row).toBe(2);
  });

  it('rejects an empty required price', () => {
    const { errors } = parseProducts([{ ...base, sellingPrice: '' }]);
    expect(errors).toHaveLength(1);
  });
});

describe('customer parser', () => {
  it('defaults segment to NEW and requires externalId', () => {
    const { valid } = parseCustomers([{ externalId: 'C-1', governorate: 'BAGHDAD', segment: '' }]);
    expect(valid[0].segment).toBe('NEW');
    const bad = parseCustomers([{ externalId: '', governorate: 'BAGHDAD' }]);
    expect(bad.errors).toHaveLength(1);
  });
});

describe('batch parser', () => {
  it('parses valid batch and rejects bad dates', () => {
    const ok = parseBatches([
      { batchNumber: 'LH-2026-1', roastDate: '2026-06-01', origin: 'Ethiopia', roastLevel: 'LIGHT', greenInputGrams: '30000', roastedOutputGrams: '25000', qcScore: '86' },
    ]);
    expect(ok.errors).toHaveLength(0);
    expect(ok.valid[0].roastedOutputGrams).toBe(25000);
    const bad = parseBatches([
      { batchNumber: 'LH-2026-2', roastDate: 'not-a-date', origin: 'X', roastLevel: 'DARK', greenInputGrams: '1', roastedOutputGrams: '1' },
    ]);
    expect(bad.errors).toHaveLength(1);
  });
});

describe('order parser', () => {
  const row = (over: Record<string, string>) => ({
    orderNumber: 'O-1',
    placedAt: '2026-06-01 10:00',
    customerExternalId: 'C-1',
    channel: 'ONLINE_STORE',
    governorate: 'BAGHDAD',
    fulfillmentMethod: 'COURIER',
    status: 'COMPLETED',
    sku: 'LH-A',
    quantity: '1',
    unitGrossPrice: '10000',
    lineDiscount: '0',
    deliveryFee: '4000',
    deliveryCost: '5000',
    ...over,
  });

  it('groups multiple line rows into one order', () => {
    const { valid, errors } = parseOrders([row({ sku: 'LH-A' }), row({ sku: 'LH-B', quantity: '2' })]);
    expect(errors).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0].lines).toHaveLength(2);
    expect(valid[0].lines[1]).toMatchObject({ sku: 'LH-B', quantity: 2 });
  });

  it('reports invalid line rows and excludes them', () => {
    const { valid, errors } = parseOrders([row({ sku: 'LH-A' }), row({ orderNumber: 'O-2', quantity: '0' })]);
    expect(errors).toHaveLength(1); // quantity must be positive
    expect(valid).toHaveLength(1); // only O-1 survived
  });
});
