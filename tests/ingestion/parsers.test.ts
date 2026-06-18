import { describe, it, expect } from 'vitest';
import {
  parseProducts,
  parseCustomers,
  parseBatches,
  parseOrders,
  parseInventory,
  parsePurchases,
  parseCapital,
} from '@/server/ingestion/parsers';

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

  it('accepts an Arabic-only catalog (nameEn blank → mirrors nameAr)', () => {
    const { valid, errors } = parseProducts([{ ...base, nameEn: '' }]);
    expect(errors).toHaveLength(0);
    expect(valid[0]).toMatchObject({ nameEn: 'إسبريسو إكس', nameAr: 'إسبريسو إكس' });
  });

  it('requires at least one name', () => {
    const { errors } = parseProducts([{ ...base, nameEn: '', nameAr: '' }]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('nameEn');
  });

  it('aliases real-world categories: CUPS→ACCESSORIES, blank/DRIP_BAG grind→NONE', () => {
    const { valid, errors } = parseProducts([
      { ...base, productLine: 'CUPS', grind: '' },
      { ...base, sku: 'PL-DB-1', productLine: 'DRIP_BAGS', grind: 'DRIP_BAG' },
    ]);
    expect(errors).toHaveLength(0);
    expect(valid[0]).toMatchObject({ productLine: 'ACCESSORIES', grind: 'NONE' });
    expect(valid[1]).toMatchObject({ productLine: 'DRIP_BAGS', grind: 'NONE' });
  });
});

describe('customer parser', () => {
  it('defaults segment to NEW and requires externalId', () => {
    const { valid } = parseCustomers([{ externalId: 'C-1', governorate: 'BAGHDAD', segment: '' }]);
    expect(valid[0].segment).toBe('NEW');
    const bad = parseCustomers([{ externalId: '', governorate: 'BAGHDAD' }]);
    expect(bad.errors).toHaveLength(1);
  });

  it('accepts all Iraqi governorates and aliases city names', () => {
    const { valid, errors } = parseCustomers([
      { externalId: 'C-2', governorate: 'WASIT' },
      { externalId: 'C-3', governorate: 'DIWANIYAH' },
      { externalId: 'C-4', governorate: 'Nasiriyah' }, // city → DHI_QAR
      { externalId: 'C-5', governorate: '' }, // blank stays undefined
    ]);
    expect(errors).toHaveLength(0);
    expect(valid.map((v) => v.governorate)).toEqual(['WASIT', 'DIWANIYAH', 'DHI_QAR', undefined]);
  });
});

describe('inventory parser', () => {
  it('parses items case-insensitively, defaults unit, aliases category', () => {
    const { valid, errors } = parseInventory([
      { Item: 'قهوة خام برازيل', Category: 'GREEN', Unit: 'GRAM', Opening: '0', Additions: '30000', Deductions: '5000' },
      { item: 'كيس تقطير', category: 'PACKING', unit: '', opening: '0', additions: '5000', deductions: '256' },
    ]);
    expect(errors).toHaveLength(0);
    expect(valid[0]).toMatchObject({ category: 'GREEN_COFFEE', unit: 'GRAM', additions: 30000, deductions: 5000 });
    expect(valid[1]).toMatchObject({ category: 'PACKAGING', unit: 'unit' });
  });

  it('requires an item name', () => {
    const { errors } = parseInventory([{ item: '', category: 'PACKAGING' }]);
    expect(errors).toHaveLength(1);
  });
});

describe('historical finance import parsers', () => {
  const purchaseRow = {
    recordKey: 'DOC000001',
    lineNo: '1',
    date: '2026-01-01',
    supplier: 'Supplier',
    invoice: 'INV-1',
    reference: 'DOC000001',
    itemType: 'INVENTORY',
    itemName: 'Green coffee',
    expenseCategory: 'GREEN_COFFEE',
    inventoryCategory: 'GREEN_COFFEE',
    assetKey: '',
    assetCategory: '',
    quantity: '2.000',
    unit: 'kg',
    sourceUnitPrice: '25000',
    sourceLineAmount: '50000',
    sourceCurrency: 'IQD',
    rate: '',
    lineAmountIqd: '50000',
    invoiceTotalIqd: '350000',
    paymentMode: 'PAID',
    paymentAccount: 'Cash on Hands',
    branchCode: 'HQ',
    notes: '',
  };

  it('groups mixed invoice lines and keeps exact invoice totals', () => {
    const result = parsePurchases([
      purchaseRow,
      {
        ...purchaseRow,
        lineNo: '2',
        itemType: 'ASSET',
        itemName: 'Roaster',
        expenseCategory: 'EQUIPMENT',
        inventoryCategory: '',
        assetKey: 'ROASTER-1',
        assetCategory: 'Production equipment',
        quantity: '1.000',
        sourceUnitPrice: '300000',
        sourceLineAmount: '300000',
        lineAmountIqd: '300000',
      },
    ]);
    expect(result.errors).toHaveLength(0);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]).toMatchObject({
      amountIqd: 350000,
      importKey: 'PUR:HISTORICAL_SPEND:DOC000001',
    });
    expect(result.valid[0].lines.map((line) => line.itemType)).toEqual(['INVENTORY', 'ASSET']);
  });

  it('rejects an invoice whose lines do not equal its parent total', () => {
    const result = parsePurchases([{ ...purchaseRow, invoiceTotalIqd: '50001' }]);
    expect(result.valid).toHaveLength(0);
    expect(result.errors[0].message).toContain('does not equal invoice total');
  });

  it('requires capital account and branch and creates a stable key', () => {
    const result = parseCapital([{
      shareholder: 'مهند منجد',
      amount: '19007895',
      currency: 'IQD',
      date: '2025-01-01',
      reference: 'HISTORICAL-CAPITAL',
      account: 'Cash on Hands',
      branchCode: 'HQ',
    }]);
    expect(result.errors).toHaveLength(0);
    expect(result.valid[0].importKey).toContain('مهند منجد:2025-01-01:19007895');
  });
});

describe('batch parser', () => {
  it('accepts green-only batches with roast details pending', () => {
    const { valid, errors } = parseBatches([
      { batchNumber: 'LC00001', roastDate: '', packagingDate: '', origin: 'Ethiopia Guji', roastLevel: '', greenInputGrams: '230', roastedOutputGrams: '', qcScore: '', qcNotes: '' },
    ]);
    expect(errors).toHaveLength(0);
    expect(valid[0]).toMatchObject({ batchNumber: 'LC00001', origin: 'Ethiopia Guji', greenInputGrams: 230 });
    expect(valid[0].roastedOutputGrams).toBeUndefined();
    expect(valid[0].roastLevel).toBeUndefined();
  });

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

  it('maps courier statuses, hand-delivery, and rounds decimal prices', () => {
    const { valid, errors } = parseOrders([
      row({ orderNumber: 'O-A', status: 'SENT_TO_CENTER', fulfillmentMethod: 'HAND_DELIVERY' }),
      row({ orderNumber: 'O-B', status: 'POSTPONED', unitGrossPrice: '9666.67' }),
      row({ orderNumber: 'O-C', status: 'DELIVERED' }),
    ]);
    expect(errors).toHaveLength(0);
    const byNum = Object.fromEntries(valid.map((o) => [o.orderNumber, o]));
    expect(byNum['O-A']).toMatchObject({ status: 'PENDING', fulfillmentMethod: 'INTERNAL_DELIVERY' });
    expect(byNum['O-B'].status).toBe('PENDING');
    expect(byNum['O-B'].lines[0].unitGrossPrice).toBe(9667);
    expect(byNum['O-C'].status).toBe('COMPLETED');
  });
});
