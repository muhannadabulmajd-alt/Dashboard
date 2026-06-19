import ExcelJS from 'exceljs';
import type { ShareholderReportData } from './shareholder-data';

const COLORS = {
  linen: 'FFF3F0DC', sage: 'FF818C55', grove: 'FF3C4220', amber: 'FFAD6830',
  cherry: 'FF96351E', roast: 'FF562D1E', white: 'FFFFFFFF', border: 'FFDDD6C8', muted: 'FF6B625A',
};
const IQD = '#,##0 "IQD";[Red](#,##0 "IQD");-';

function setupSheet(sheet: ExcelJS.Worksheet, widths: number[]): void {
  sheet.views = [{ showGridLines: false, state: 'frozen', ySplit: 1 }];
  sheet.columns = widths.map((width) => ({ width }));
  sheet.properties.defaultRowHeight = 19;
}

function title(sheet: ExcelJS.Worksheet, text: string, columns: number): void {
  sheet.mergeCells(1, 1, 1, columns);
  const cell = sheet.getCell(1, 1);
  cell.value = text;
  cell.font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: COLORS.white } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.grove } };
  cell.alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 32;
}

function header(row: ExcelJS.Row): void {
  row.font = { name: 'Aptos', bold: true, color: { argb: COLORS.white } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.roast } };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 26;
}

function tableBorders(sheet: ExcelJS.Worksheet, startRow: number, endRow: number, columns: number): void {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = 1; col <= columns; col += 1) {
      const cell = sheet.getCell(row, col);
      cell.border = { bottom: { style: 'thin', color: { argb: COLORS.border } } };
      cell.alignment = { ...cell.alignment, vertical: 'middle', wrapText: col === 1 || col === 2 };
      if (row % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF8F2' } };
    }
  }
}

function addDataBars(sheet: ExcelJS.Worksheet, range: string): void {
  sheet.addConditionalFormatting({
    ref: range,
    rules: [{ type: 'colorScale', priority: 1, cfvo: [{ type: 'min' }, { type: 'max' }], color: [{ argb: COLORS.linen }, { argb: COLORS.amber }] }],
  });
}

export async function buildShareholderWorkbook(data: ShareholderReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Laheeb Atlas';
  wb.company = 'Laheeb Coffee';
  wb.subject = `Shareholder finance report ${data.snapshotHash}`;
  wb.created = data.generatedAt;

  const summary = wb.addWorksheet('Executive Summary');
  setupSheet(summary, [34, 34, 22, 22]);
  title(summary, 'Shareholder Finance Report / التقرير المالي للمساهمين', 4);
  summary.addRow(['As of / حتى', data.asOf, 'Snapshot / البصمة', data.snapshotHash]);
  summary.getCell('B2').numFmt = 'yyyy-mm-dd hh:mm';
  summary.addRow([]);
  header(summary.addRow(['Metric', 'المؤشر', 'Amount / المبلغ', 'Status / الحالة']));
  const summaryRows: [string, string, number, string][] = [
    ['Capital received', 'رأس المال المستلم', data.baseline.capitalReceived, ''],
    ['Total spending', 'إجمالي الإنفاق', data.baseline.totalSpending, ''],
    ['Paid spending', 'الإنفاق المدفوع', data.baseline.paidSpending, ''],
    ['Outstanding payable', 'المبلغ المستحق', data.baseline.outstandingPayable, ''],
    ['Cash balance', 'الرصيد النقدي', data.baseline.cashBalance, ''],
    ['Inventory value', 'قيمة المخزون', data.baseline.inventoryValue, ''],
    ['Fixed assets', 'الأصول الثابتة', data.baseline.fixedAssetValue, ''],
    ['Operating spending', 'الإنفاق التشغيلي', data.baseline.operatingSpending, ''],
  ];
  for (const row of summaryRows) summary.addRow(row);
  summary.getColumn(3).numFmt = IQD;
  tableBorders(summary, 5, summary.lastRow?.number ?? 5, 4);
  summary.addRow([]);
  summary.addRow(['Internal reconciliation / المطابقة الداخلية', '', data.internalIntegrityPercent / 100, data.internallyReconciled ? 'PASS' : 'FAIL']);
  summary.addRow(['Atlas traceability / تتبع أطلس', '', data.traceabilityPercent / 100, `${data.baseline.tracedRecords}/${data.baseline.spendingRecords}`]);
  summary.addRow(['Attached documents / المستندات المرفقة', '', data.attachmentCoveragePercent / 100, `${data.baseline.attachedRecords}/${data.baseline.spendingRecords}`]);
  summary.getCell(`C${(summary.lastRow?.number ?? 1) - 2}`).numFmt = '0.0%';
  summary.getCell(`C${(summary.lastRow?.number ?? 1) - 1}`).numFmt = '0.0%';
  summary.getCell(`C${summary.lastRow?.number ?? 1}`).numFmt = '0.0%';

  const detail = wb.addWorksheet('Spending Detail');
  setupSheet(detail, [15, 14, 24, 32, 13, 18, 16, 12, 13, 16, 16, 16, 16, 16, 18, 16, 20]);
  title(detail, 'Every Spending Line / كل بند إنفاق', 17);
  header(detail.addRow(['Record Key', 'Date', 'Supplier', 'Description', 'Line', 'Type', 'Item', 'Quantity', 'Unit', 'Unit Cost', 'Line Total', 'Invoice Total', 'Paid', 'Outstanding', 'Payment', 'Account', 'Reference']));
  for (const row of data.spendLines) detail.addRow([
    row.recordKey, row.date, row.supplier, row.description, row.lineNo, row.itemType, row.itemName,
    row.quantity, row.unit, row.unitCost, row.lineTotal, row.invoiceTotal, row.paidAmount,
    row.outstanding, row.paymentStatus, row.account, row.reference,
  ]);
  detail.autoFilter = { from: 'A2', to: `Q${detail.lastRow?.number ?? 2}` };
  detail.getColumn(2).numFmt = 'yyyy-mm-dd';
  detail.getColumn(8).numFmt = '0.000';
  for (const col of [10, 11, 12, 13, 14]) detail.getColumn(col).numFmt = IQD;
  tableBorders(detail, 3, detail.lastRow?.number ?? 3, 17);

  const monthly = wb.addWorksheet('Monthly Spending');
  setupSheet(monthly, [18, 22, 22, 18]);
  title(monthly, 'Monthly Spending / الإنفاق الشهري', 4);
  header(monthly.addRow(['Month / الشهر', 'Total / الإجمالي', 'Paid / المدفوع', 'Outstanding / المستحق']));
  for (const row of data.monthlySpending) monthly.addRow([row.month, row.amount, row.paid, row.amount - row.paid]);
  for (const col of [2, 3, 4]) monthly.getColumn(col).numFmt = IQD;
  tableBorders(monthly, 3, monthly.lastRow?.number ?? 3, 4);
  if ((monthly.lastRow?.number ?? 2) >= 3) addDataBars(monthly, `B3:B${monthly.lastRow?.number}`);

  const categories = wb.addWorksheet('Categories & Suppliers');
  setupSheet(categories, [28, 22, 4, 34, 22]);
  title(categories, 'Spending Analysis / تحليل الإنفاق', 5);
  header(categories.addRow(['Category / التصنيف', 'Amount / المبلغ', '', 'Supplier / المورد', 'Amount / المبلغ']));
  const maxAnalysisRows = Math.max(data.spendingByCategory.length, data.spendingBySupplier.length);
  for (let i = 0; i < maxAnalysisRows; i += 1) categories.addRow([
    data.spendingByCategory[i]?.name ?? '', data.spendingByCategory[i]?.amount ?? '', '',
    data.spendingBySupplier[i]?.name ?? '', data.spendingBySupplier[i]?.amount ?? '',
  ]);
  categories.getColumn(2).numFmt = IQD;
  categories.getColumn(5).numFmt = IQD;
  tableBorders(categories, 3, categories.lastRow?.number ?? 3, 5);
  if ((categories.lastRow?.number ?? 2) >= 3) {
    addDataBars(categories, `B3:B${categories.lastRow?.number}`);
    addDataBars(categories, `E3:E${categories.lastRow?.number}`);
  }

  const inventory = wb.addWorksheet('Inventory');
  setupSheet(inventory, [30, 30, 14, 18, 22]);
  title(inventory, 'Inventory Position / وضع المخزون', 5);
  header(inventory.addRow(['Name', 'الاسم', 'Unit / الوحدة', 'Quantity / الكمية', 'FIFO Value / قيمة FIFO']));
  for (const row of data.inventory) inventory.addRow([row.nameEn, row.nameAr, row.unit, row.quantity, row.value]);
  inventory.getColumn(4).numFmt = '0.000';
  inventory.getColumn(5).numFmt = IQD;
  tableBorders(inventory, 3, inventory.lastRow?.number ?? 3, 5);

  const assets = wb.addWorksheet('Fixed Assets');
  setupSheet(assets, [38, 24, 18, 14, 22]);
  title(assets, 'Fixed Assets / الأصول الثابتة', 5);
  header(assets.addRow(['Asset / الأصل', 'Category / التصنيف', 'Quantity / الكمية', 'Unit / الوحدة', 'Total Cost / الكلفة']));
  for (const row of data.fixedAssets) assets.addRow([row.name, row.category, row.quantity, row.unit, row.totalCost]);
  assets.getColumn(3).numFmt = '0.000';
  assets.getColumn(5).numFmt = IQD;
  tableBorders(assets, 3, assets.lastRow?.number ?? 3, 5);

  const capital = wb.addWorksheet('Capital & Cash');
  setupSheet(capital, [34, 22, 4, 34, 16, 22]);
  title(capital, 'Capital, Cash and Dues / رأس المال والنقد والمستحقات', 6);
  header(capital.addRow(['Shareholder / المساهم', 'Capital / رأس المال', '', 'Account / الحساب', 'Currency / العملة', 'Balance / الرصيد']));
  const maxCapitalRows = Math.max(data.capitalByOwner.length, data.accountBalances.length);
  for (let i = 0; i < maxCapitalRows; i += 1) capital.addRow([
    data.capitalByOwner[i]?.name ?? '', data.capitalByOwner[i]?.amount ?? '', '',
    data.accountBalances[i]?.name ?? '', data.accountBalances[i]?.currency ?? '', data.accountBalances[i]?.amount ?? '',
  ]);
  capital.getColumn(2).numFmt = IQD;
  capital.getColumn(6).numFmt = IQD;
  capital.addRow([]);
  capital.addRow(['Outstanding payable / المبلغ المستحق', data.baseline.outstandingPayable]);
  capital.addRow(['Outstanding receivable / المبلغ المطلوب', data.baseline.outstandingReceivable]);
  capital.getColumn(2).numFmt = IQD;
  tableBorders(capital, 3, capital.lastRow?.number ?? 3, 6);

  const checks = wb.addWorksheet('Integrity Checks');
  setupSheet(checks, [28, 14, 18, 18, 18, 14, 50, 44]);
  title(checks, 'Data Integrity Checks / فحوصات سلامة البيانات', 8);
  header(checks.addRow(['Check', 'Status', 'Actual', 'Expected', 'Difference', 'Tolerance', 'Explanation', 'Affected Records']));
  for (const row of data.checks) checks.addRow([row.key, row.status, row.actual, row.expected, row.difference, row.tolerance, row.note, row.affectedRecords.join(', ')]);
  tableBorders(checks, 3, checks.lastRow?.number ?? 3, 8);
  checks.addConditionalFormatting({ ref: `B3:B${checks.lastRow?.number ?? 3}`, rules: [
    { type: 'containsText', priority: 1, operator: 'containsText', text: 'PASS', style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFE7F0D8' } }, font: { color: { argb: COLORS.grove } } } },
    { type: 'containsText', priority: 2, operator: 'containsText', text: 'FAIL', style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF8DDD5' } }, font: { color: { argb: COLORS.cherry } } } },
  ] });

  const sources = wb.addWorksheet('Sources & Notes');
  setupSheet(sources, [30, 100]);
  title(sources, 'Sources and Assurance Notes / المصادر وملاحظات التأكيد', 2);
  header(sources.addRow(['Item / البند', 'Source or note / المصدر أو الملاحظة']));
  sources.addRow(['System of record', 'Laheeb Atlas production database. Active records only; archived, reversed and reversal entries are excluded.']);
  sources.addRow(['Snapshot hash', data.snapshotHash]);
  sources.addRow(['Record traceability', `${data.baseline.tracedRecords}/${data.baseline.spendingRecords} spending records have immutable Atlas DOC keys.`]);
  sources.addRow(['Documentary evidence', `${data.baseline.attachedRecords}/${data.baseline.spendingRecords} spending records have an attached document. Record keys do not independently prove supplier invoices or bank movements.`]);
  sources.addRow(['Period', `${data.firstActivityAt?.toISOString() ?? '-'} through ${data.asOf.toISOString()}`]);
  tableBorders(sources, 3, sources.lastRow?.number ?? 3, 2);

  for (const sheet of wb.worksheets) {
    sheet.eachRow((row) => row.eachCell((cell) => {
      cell.font = { name: 'Aptos', size: 10, color: { argb: COLORS.roast }, ...cell.font };
    }));
    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
