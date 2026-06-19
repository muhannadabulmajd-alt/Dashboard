import { createElement } from 'react';
import ExcelJS from 'exceljs';
import { renderToBuffer } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { buildShareholderReportData } from '@/server/reports/shareholder-data';
import { ShareholderReportPdf } from '@/server/reports/ShareholderReportPdf';
import { buildShareholderWorkbook } from '@/server/reports/shareholder-workbook';

const asOf = new Date('2026-06-19T12:00:00.000Z');
const date = new Date('2026-06-01T00:00:00.000Z');

function entry(overrides: Record<string, unknown>) {
  return {
    id: 'entry', recordKey: null, date, type: 'PURCHASE', amount: 0, currency: 'IQD', obligation: false,
    obligationKind: null, accountId: null, toAccountId: null, settlesId: null, archivedAt: null,
    reversedAt: null, reversalOfId: null, createdById: 'owner', createdAt: date, branchId: 'hq',
    reference: null, attachmentUrl: null, description: null, party: null, account: null,
    settlements: [], ledgerLines: [], stockMovements: [], costLayers: [], fixedAssets: [],
    ...overrides,
  };
}

function line(overrides: Record<string, unknown>) {
  return {
    id: 'line', lineNo: 1, itemType: 'EXPENSE', itemName: 'Expense', categoryType: 'OVERHEAD',
    inventoryItemId: null, quantity: { toNumber: () => 1 }, unit: 'unit', unitCost: { toNumber: () => 0 },
    landedUnitCost: { toNumber: () => 0 }, discountAmount: 0, extraAmount: 0, lineTotal: 0,
    ...overrides,
  };
}

function fakeDb(missingRecordKey = false) {
  const capital = entry({
    id: 'capital', type: 'CAPITAL_IN', amount: 1_000, accountId: 'cash',
    party: { name: 'Owner' }, account: { name: 'Cash' },
  });
  const mixed = entry({
    id: 'mixed', recordKey: missingRecordKey ? null : 'DOC000100', amount: 600, accountId: 'cash',
    party: { name: 'Supplier A' }, account: { name: 'Cash' }, reference: 'INV-1', description: 'Mixed purchase',
    ledgerLines: [
      line({ id: 'inventory-line', lineNo: 1, itemType: 'INVENTORY', itemName: 'Green bean', categoryType: 'GREEN_COFFEE', inventoryItemId: 'beans', quantity: { toNumber: () => 2 }, unit: 'kg', unitCost: { toNumber: () => 100 }, landedUnitCost: { toNumber: () => 100 }, lineTotal: 200 }),
      line({ id: 'asset-line', lineNo: 2, itemType: 'ASSET', itemName: 'Scale', categoryType: 'EQUIPMENT', unitCost: { toNumber: () => 200 }, landedUnitCost: { toNumber: () => 200 }, lineTotal: 200 }),
      line({ id: 'expense-line', lineNo: 3, itemType: 'EXPENSE', itemName: 'Delivery', categoryType: 'DELIVERY', unitCost: { toNumber: () => 200 }, landedUnitCost: { toNumber: () => 200 }, lineTotal: 200 }),
    ],
    stockMovements: [{ id: 'movement', inventoryItemId: 'beans', quantity: { toNumber: () => 2 } }],
    costLayers: [{ id: 'layer', inventoryItemId: 'beans', qtyReceived: { toNumber: () => 2 }, unitCost: { toNumber: () => 100 } }],
  });
  const unpaid = entry({
    id: 'unpaid', recordKey: 'DOC000101', amount: 100, obligation: true, obligationKind: 'PAYABLE',
    party: { name: 'Supplier B' }, description: 'Unpaid service',
    ledgerLines: [line({ id: 'service-line', itemType: 'SERVICE', itemName: 'Design', categoryType: 'OVERHEAD', unitCost: { toNumber: () => 100 }, landedUnitCost: { toNumber: () => 100 }, lineTotal: 100 })],
  });
  return {
    financeEntry: { findMany: async () => [capital, mixed, unpaid] },
    financeAccount: { findMany: async () => [{ id: 'cash', name: 'Cash', currency: 'IQD', openingBalance: 0 }] },
    inventoryItem: { findMany: async () => [{
      id: 'beans', category: 'GREEN_BEAN', nameEn: 'Green bean', nameAr: 'بن أخضر', unit: 'kg',
      reorderPoint: null, avgDailyUsage: null, unitCost: { toNumber: () => 100 },
      movements: [{ occurredAt: date, reason: 'PURCHASE', quantity: { toNumber: () => 2 }, expiryDate: null }],
      costLayers: [{ id: 'layer', qtyReceived: { toNumber: () => 2 }, unitCost: { toNumber: () => 100 }, receivedAt: date }],
    }] },
    fixedAsset: { findMany: async () => [{ name: 'Scale', category: 'Equipment', quantity: { toNumber: () => 1 }, unit: 'unit', totalCost: 200, importKey: null, financeEntryId: 'mixed' }] },
    order: { findMany: async () => [] },
    branch: { findMany: async () => [{ id: 'hq', nameEn: 'HQ', nameAr: 'المقر' }] },
    listOption: { findMany: async () => [] },
  };
}

function fakeDbWithDirectExpense() {
  const db = fakeDb() as ReturnType<typeof fakeDb> & {
    financeEntry: { findMany: () => Promise<ReturnType<typeof entry>[]> };
  };
  const baseFindMany = db.financeEntry.findMany;
  db.financeEntry.findMany = async () => [
    ...await baseFindMany(),
    entry({
      id: 'delivery',
      recordKey: 'DOC000102',
      type: 'EXPENSE',
      amount: 25,
      obligation: true,
      obligationKind: 'PAYABLE',
      categoryType: 'SHIPPING',
      party: { name: 'Courier' },
      description: 'Delivery cost',
    }),
  ];
  return db;
}

describe('shareholder finance report', () => {
  it('reconciles capital, mixed spending, FIFO inventory, assets, cash and payables', async () => {
    const report = await buildShareholderReportData({ asOf, db: fakeDb() as never });
    expect(report.baseline).toMatchObject({
      capitalReceived: 1_000,
      totalSpending: 700,
      paidSpending: 600,
      outstandingPayable: 100,
      cashBalance: 400,
      inventoryPurchases: 200,
      inventoryValue: 200,
      fixedAssetPurchases: 200,
      fixedAssetValue: 200,
      operatingSpending: 300,
      spendingRecords: 2,
      tracedRecords: 2,
    });
    expect(report.internallyReconciled).toBe(true);
    expect(report.internalIntegrityPercent).toBe(100);
    expect(report.spendLines).toHaveLength(4);
    expect(report.spendLines.reduce((total, row) => total + row.paidAmount, 0)).toBe(600);
    expect(report.spendLines.reduce((total, row) => total + row.outstanding, 0)).toBe(100);
    expect(report.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    const laterReport = await buildShareholderReportData({ asOf: new Date('2026-06-20T12:00:00.000Z'), db: fakeDb() as never });
    expect(laterReport.snapshotHash).toBe(report.snapshotHash);
  });

  it('fails internal assurance when a spending record lacks its DOC key', async () => {
    const report = await buildShareholderReportData({ asOf, db: fakeDb(true) as never });
    expect(report.internallyReconciled).toBe(false);
    expect(report.checks.find((row) => row.key === 'record_key_traceability')?.status).toBe('FAIL');
  });

  it('reconciles direct operating expenses without fabricating ledger records', async () => {
    const report = await buildShareholderReportData({ asOf, db: fakeDbWithDirectExpense() as never });
    expect(report.internallyReconciled).toBe(true);
    expect(report.baseline.totalSpending).toBe(725);
    expect(report.baseline.operatingSpending).toBe(325);
    expect(report.spendLines.find((row) => row.entryId === 'delivery')).toMatchObject({
      itemType: 'EXPENSE',
      category: 'SHIPPING',
      lineTotal: 25,
    });
  });

  it('renders the Arabic PDF and creates the bilingual audit workbook', async () => {
    const report = await buildShareholderReportData({ asOf, db: fakeDb() as never });
    const pdf = await renderToBuffer(createElement(ShareholderReportPdf, { data: report, locale: 'ar' }) as Parameters<typeof renderToBuffer>[0]);
    expect(pdf.byteLength).toBeGreaterThan(10_000);

    const xlsx = await buildShareholderWorkbook(report);
    const parsed = new ExcelJS.Workbook();
    await parsed.xlsx.load(xlsx as unknown as ExcelJS.Buffer);
    expect(parsed.worksheets.map((sheet) => sheet.name)).toEqual([
      'Executive Summary', 'Spending Detail', 'Monthly Spending', 'Categories & Suppliers',
      'Inventory', 'Fixed Assets', 'Capital & Cash', 'Integrity Checks', 'Sources & Notes',
    ]);
    expect(parsed.getWorksheet('Spending Detail')?.rowCount).toBe(6);
    expect(parsed.getWorksheet('Executive Summary')?.getCell('C5').value).toBe(1_000);
  });
});
