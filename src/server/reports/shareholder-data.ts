import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { decimalNumber } from '@/lib/decimal';
import { accountBalance, financeTotals, netCash, unassignedCash, type FinanceEntryLike } from '@/lib/metrics/finance';
import { stockRow } from '@/lib/metrics/inventory';
import { allocateInteger } from '@/lib/metrics/sales';
import { orderStatusRole } from '@/lib/metrics/status';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type IntegrityStatus = 'PASS' | 'WARNING' | 'FAIL';

export interface IntegrityCheckResult {
  key: string;
  status: IntegrityStatus;
  actual: number | string;
  expected: number | string;
  difference: number;
  tolerance: number;
  affectedRecords: string[];
  note: string;
}

export interface ShareholderSpendLine {
  recordKey: string;
  entryId: string;
  date: Date;
  supplier: string;
  description: string;
  lineNo: number;
  itemType: string;
  itemName: string;
  category: string;
  quantity: number;
  unit: string;
  unitCost: number;
  lineTotal: number;
  invoiceTotal: number;
  paidAmount: number;
  outstanding: number;
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID';
  account: string;
  branch: string;
  reference: string;
  hasAttachment: boolean;
}

export interface ShareholderReportData {
  generatedAt: Date;
  firstActivityAt: Date | null;
  asOf: Date;
  snapshotHash: string;
  baseline: {
    capitalReceived: number;
    totalSpending: number;
    paidSpending: number;
    outstandingPayable: number;
    outstandingReceivable: number;
    cashBalance: number;
    inventoryPurchases: number;
    inventoryValue: number;
    fixedAssetPurchases: number;
    fixedAssetValue: number;
    operatingSpending: number;
    salesOrders: number;
    grossSales: number;
    spendingRecords: number;
    tracedRecords: number;
    attachedRecords: number;
    totalAssets: number;
    totalLiabilities: number;
    retainedEarnings: number;
  };
  spendLines: ShareholderSpendLine[];
  monthlySpending: { month: string; amount: number; paid: number }[];
  spendingByClass: { key: 'INVENTORY' | 'FIXED_ASSET' | 'OPERATING'; amount: number }[];
  spendingByCategory: { name: string; amount: number }[];
  spendingBySupplier: { name: string; amount: number }[];
  capitalByOwner: { name: string; amount: number }[];
  accountBalances: { name: string; currency: string; amount: number }[];
  inventory: { nameEn: string; nameAr: string; unit: string; quantity: number; value: number }[];
  fixedAssets: { name: string; category: string; quantity: number; unit: string; totalCost: number }[];
  checks: IntegrityCheckResult[];
  internallyReconciled: boolean;
  internalIntegrityPercent: number;
  traceabilityPercent: number;
  attachmentCoveragePercent: number;
}

const activeEntryWhere = (asOf: Date): Prisma.FinanceEntryWhereInput => ({
  date: { lte: asOf },
  archivedAt: null,
  reversedAt: null,
  reversalOfId: null,
});

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function check(
  key: string,
  actual: number,
  expected: number,
  affectedRecords: string[],
  note: string,
  tolerance = 0,
  warningOnly = false,
): IntegrityCheckResult {
  const difference = actual - expected;
  const matches = Math.abs(difference) <= tolerance;
  return {
    key,
    status: matches ? 'PASS' : warningOnly ? 'WARNING' : 'FAIL',
    actual,
    expected,
    difference,
    tolerance,
    affectedRecords: affectedRecords.slice(0, 50),
    note,
  };
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function buildShareholderReportData(
  options: { asOf?: Date; db: DbClient },
): Promise<ShareholderReportData> {
  const db = options.db;
  const asOf = options.asOf ?? new Date();
  const where = activeEntryWhere(asOf);

  const [entries, accounts, inventoryRows, fixedAssets, orders, branches, orderStatusOptions] = await Promise.all([
    db.financeEntry.findMany({
      where,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: {
        party: { select: { name: true } },
        account: { select: { name: true } },
        settlements: {
          where: activeEntryWhere(asOf),
          select: { id: true, amount: true },
        },
        ledgerLines: {
          orderBy: { lineNo: 'asc' },
          select: {
            id: true,
            lineNo: true,
            itemType: true,
            itemName: true,
            assetKey: true,
            categoryType: true,
            inventoryItemId: true,
            spendTreatment: true,
            classificationStatus: true,
            classificationNote: true,
            quantity: true,
            unit: true,
            unitCost: true,
            landedUnitCost: true,
            discountAmount: true,
            extraAmount: true,
            lineTotal: true,
            fixedAssetCostAllocations: {
              where: { financeEntry: activeEntryWhere(asOf) },
              select: { id: true, amount: true, fixedAssetId: true },
            },
            landedCostAllocations: {
              where: { financeEntry: activeEntryWhere(asOf) },
              select: { id: true, amount: true, inventoryItemId: true, costLayerId: true },
            },
          },
        },
        stockMovements: { select: { id: true, inventoryItemId: true, quantity: true } },
        costLayers: { select: { id: true, inventoryItemId: true, qtyReceived: true, unitCost: true } },
      },
    }),
    db.financeAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    db.inventoryItem.findMany({
      orderBy: { nameEn: 'asc' },
      select: {
        id: true,
        category: true,
        nameEn: true,
        nameAr: true,
        unit: true,
        reorderPoint: true,
        avgDailyUsage: true,
        unitCost: true,
        movements: {
          where: {
            occurredAt: { lte: asOf },
            OR: [{ financeEntryId: null }, { financeEntry: activeEntryWhere(asOf) }],
          },
          select: { occurredAt: true, reason: true, quantity: true, expiryDate: true },
        },
        costLayers: {
          where: {
            receivedAt: { lte: asOf },
            OR: [{ financeEntryId: null }, { financeEntry: activeEntryWhere(asOf) }],
          },
          select: { id: true, qtyReceived: true, unitCost: true, receivedAt: true },
        },
      },
    }),
    db.fixedAsset.findMany({
      where: {
        isActive: true,
        archivedAt: null,
        purchaseDate: { lte: asOf },
        OR: [{ financeEntryId: null }, { financeEntry: activeEntryWhere(asOf) }],
      },
      orderBy: { purchaseDate: 'asc' },
      select: {
        id: true,
        name: true,
        category: true,
        quantity: true,
        unit: true,
        totalCost: true,
        importKey: true,
        financeEntryId: true,
        costAllocations: {
          where: { financeEntry: activeEntryWhere(asOf) },
          select: { amount: true },
        },
      },
    }),
    db.order.findMany({
      where: { placedAt: { lte: asOf } },
      select: {
        status: true,
        purpose: true,
        grossAmount: true,
        discountAmount: true,
        refundAmount: true,
        deliveryFee: true,
        extraCharges: true,
      },
    }),
    db.branch.findMany({ select: { id: true, nameEn: true, nameAr: true } }),
    db.listOption.findMany({
      where: { listKey: 'orderStatus', isActive: true },
      select: { code: true, metricRole: true },
    }),
  ]);

  const financeEntries: FinanceEntryLike[] = entries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    amount: entry.amount,
    currency: entry.currency,
    obligation: entry.obligation,
    obligationKind: entry.obligationKind,
    accountId: entry.accountId,
    toAccountId: entry.toAccountId,
    settlesId: entry.settlesId,
    archivedAt: entry.archivedAt,
    reversedAt: entry.reversedAt,
    reversalOfId: entry.reversalOfId,
  }));
  const totals = financeTotals(financeEntries);
  const spendingEntries = entries.filter((entry) => entry.type === 'PURCHASE' || entry.type === 'EXPENSE');
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));

  let inventoryPurchases = 0;
  let fixedAssetPurchases = 0;
  let operatingSpending = 0;
  const parentMismatchIds: string[] = [];
  const lineMathMismatchIds: string[] = [];
  const allocationMismatchIds: string[] = [];
  const inventoryLinkMismatchIds: string[] = [];
  const assetMismatchIds: string[] = [];
  const untracedIds: string[] = [];
  const duplicateRecordKeys: string[] = [];
  const seenKeys = new Set<string>();
  const monthly = new Map<string, { amount: number; paid: number }>();
  const categoryTotals = new Map<string, number>();
  const supplierTotals = new Map<string, number>();
  const spendLines: ShareholderSpendLine[] = [];

  for (const entry of spendingEntries) {
    const recordKey = entry.recordKey ?? '';
    if (!recordKey) untracedIds.push(entry.id);
    else if (seenKeys.has(recordKey)) duplicateRecordKeys.push(recordKey);
    else seenKeys.add(recordKey);

    const paidAmount = entry.obligation
      ? sum(entry.settlements.map((settlement) => settlement.amount))
      : entry.amount;
    const outstanding = Math.max(0, entry.amount - paidAmount);
    const paymentStatus = outstanding === 0 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID';
    const reportLines = entry.ledgerLines.length > 0
      ? entry.ledgerLines
      : [{
          id: `${entry.id}:direct`,
          lineNo: 1,
          itemType: 'EXPENSE',
          itemName: entry.description ?? 'Operating expense',
          assetKey: null,
          categoryType: entry.categoryType,
          inventoryItemId: null,
          spendTreatment: 'OPEX' as const,
          classificationStatus: 'CONFIRMED' as const,
          classificationNote: null,
          quantity: 1,
          unit: 'unit',
          unitCost: entry.amount,
          landedUnitCost: entry.amount,
          discountAmount: 0,
          extraAmount: 0,
          lineTotal: entry.amount,
          fixedAssetCostAllocations: [],
          landedCostAllocations: [],
        }];
    const lineWeights = reportLines.map((line) => line.lineTotal);
    const paidByLine = allocateInteger(paidAmount, lineWeights);
    const outstandingByLine = allocateInteger(outstanding, lineWeights);
    const month = entry.date.toISOString().slice(0, 7);
    const monthRow = monthly.get(month) ?? { amount: 0, paid: 0 };
    monthRow.amount += entry.amount;
    monthRow.paid += paidAmount;
    monthly.set(month, monthRow);
    supplierTotals.set(entry.party?.name ?? 'Unassigned', (supplierTotals.get(entry.party?.name ?? 'Unassigned') ?? 0) + entry.amount);

    const lineTotal = sum(reportLines.map((line) => line.lineTotal));
    if (lineTotal !== entry.amount) parentMismatchIds.push(entry.id);
    let allocated = 0;
    for (const [lineIndex, line] of reportLines.entries()) {
      const quantity = decimalNumber(line.quantity);
      const unitCost = decimalNumber(line.unitCost);
      const landedUnitCost = decimalNumber(line.landedUnitCost);
      const decimalPrecisionTolerance = Math.ceil((quantity * 0.0005) + 0.5);
      if (Math.abs(Math.round(landedUnitCost * quantity) - line.lineTotal) > decimalPrecisionTolerance) {
        lineMathMismatchIds.push(line.id);
      }
      allocated += line.lineTotal;
      if (line.spendTreatment === 'INVENTORY') {
        inventoryPurchases += line.lineTotal;
      } else if (line.spendTreatment === 'CAPEX') {
        fixedAssetPurchases += line.lineTotal;
        if (sum(line.fixedAssetCostAllocations.map((allocation) => allocation.amount)) !== line.lineTotal) {
          assetMismatchIds.push(line.id);
        }
      } else {
        operatingSpending += line.lineTotal;
      }
      const category = line.spendTreatment === 'CAPEX'
        ? 'FIXED_ASSET'
        : line.spendTreatment === 'INVENTORY'
          ? line.categoryType ?? 'INVENTORY'
          : line.classificationStatus === 'NEEDS_REVIEW'
            ? `REVIEW:${line.categoryType ?? line.itemType}`
            : line.categoryType ?? line.itemType;
      categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + line.lineTotal);

      if (line.spendTreatment === 'INVENTORY') {
        const movement = entry.stockMovements.find((row) => row.inventoryItemId === line.inventoryItemId);
        const layer = entry.costLayers.find((row) => row.inventoryItemId === line.inventoryItemId);
        const isLandedCost = sum(
          line.landedCostAllocations.map((allocation) => allocation.amount),
        ) === line.lineTotal;
        if (!isLandedCost && (
          !line.inventoryItemId
          || !movement
          || !layer
          || decimalNumber(movement.quantity) !== quantity
          || decimalNumber(layer.qtyReceived) !== quantity
          || Math.abs(decimalNumber(layer.unitCost) - landedUnitCost) > 0.001
        )) {
          inventoryLinkMismatchIds.push(line.id);
        }
      }

      spendLines.push({
        recordKey: recordKey || `UNTRACED-${entry.id.slice(-8)}`,
        entryId: entry.id,
        date: entry.date,
        supplier: entry.party?.name ?? '',
        description: entry.description ?? '',
        lineNo: line.lineNo,
        itemType: line.spendTreatment,
        itemName: line.itemName,
        category,
        quantity,
        unit: line.unit,
        unitCost,
        lineTotal: line.lineTotal,
        invoiceTotal: entry.amount,
        paidAmount: paidByLine[lineIndex] ?? 0,
        outstanding: outstandingByLine[lineIndex] ?? 0,
        paymentStatus,
        account: entry.account?.name ?? '',
        branch: entry.branchId ? (branchById.get(entry.branchId)?.nameEn ?? branchById.get(entry.branchId)?.nameAr ?? '') : '',
        reference: entry.reference ?? '',
        hasAttachment: Boolean(entry.attachmentUrl),
      });
    }
    if (allocated !== entry.amount) allocationMismatchIds.push(entry.id);
  }
  for (const asset of fixedAssets) {
    if (
      asset.costAllocations
      && sum(asset.costAllocations.map((allocation) => allocation.amount)) !== asset.totalCost
    ) {
      assetMismatchIds.push(asset.id);
    }
  }

  const inventory = inventoryRows.map((item) => {
    const normalized = {
      ...item,
      reorderPoint: item.reorderPoint == null ? null : decimalNumber(item.reorderPoint),
      unitCost: item.unitCost == null ? null : decimalNumber(item.unitCost),
      movements: item.movements.map((movement) => ({ ...movement, quantity: decimalNumber(movement.quantity) })),
      costLayers: item.costLayers.map((layer) => ({ ...layer, qtyReceived: decimalNumber(layer.qtyReceived), unitCost: decimalNumber(layer.unitCost) })),
    };
    const row = stockRow(normalized);
    return { nameEn: item.nameEn, nameAr: item.nameAr, unit: item.unit, quantity: row.current, value: row.value };
  });
  const negativeInventory = inventory.filter((row) => row.quantity < 0).map((row) => row.nameEn);
  const inventoryValue = Math.round(sum(inventory.map((row) => row.value)));
  const fixedAssetValue = sum(fixedAssets.map((asset) => asset.totalCost));
  const cashBalance = netCash(accounts, financeEntries);
  const accountBalances = accounts.map((account) => ({
    name: account.name,
    currency: account.currency,
    amount: accountBalance(account, financeEntries),
  }));
  const unassignedCashBalance = unassignedCash(financeEntries);
  if (unassignedCashBalance !== 0) {
    accountBalances.push({ name: 'Unassigned cash', currency: 'IQD' as const, amount: unassignedCashBalance });
  }
  const capitalEntries = entries.filter((entry) => entry.type === 'CAPITAL_IN');
  const capitalByOwnerMap = new Map<string, number>();
  for (const entry of capitalEntries) {
    const owner = entry.party?.name ?? 'Unassigned';
    capitalByOwnerMap.set(owner, (capitalByOwnerMap.get(owner) ?? 0) + entry.amount);
  }
  const capitalReceived = sum(capitalEntries.map((entry) => entry.amount));
  const totalSpending = sum(spendingEntries.map((entry) => entry.amount));
  const paidSpending = sum(spendingEntries.map((entry) => entry.obligation ? sum(entry.settlements.map((settlement) => settlement.amount)) : entry.amount));
  const totalAssets = cashBalance + totals.outstandingReceivable + inventoryValue + fixedAssetValue;
  const totalLiabilities = totals.outstandingPayable;
  const retainedEarnings = totalAssets - totalLiabilities - capitalReceived;
  const lineTotal = sum(spendLines.map((line) => line.lineTotal));
  const attachedRecords = spendingEntries.filter((entry) => Boolean(entry.attachmentUrl)).length;
  const creatorlessIds = entries.filter((entry) => !entry.createdById).map((entry) => entry.id);

  const checks: IntegrityCheckResult[] = [
    check('parent_line_totals', lineTotal, totalSpending, parentMismatchIds, 'Every spending parent equals its ledger lines.'),
    check('spending_allocation', inventoryPurchases + fixedAssetPurchases + operatingSpending, totalSpending, allocationMismatchIds, 'Every IQD is classified as inventory, fixed assets, or operating spending.'),
    check('record_key_traceability', spendingEntries.length - untracedIds.length, spendingEntries.length, untracedIds, 'Every spending record has an immutable Atlas DOC key.'),
    check('record_key_uniqueness', duplicateRecordKeys.length, 0, duplicateRecordKeys, 'Atlas DOC keys are unique.'),
    check('line_arithmetic', lineMathMismatchIds.length, 0, lineMathMismatchIds, 'Line totals reconcile within the rounding envelope of three-decimal unit costs.'),
    check('inventory_links', inventoryLinkMismatchIds.length, 0, inventoryLinkMismatchIds, 'Inventory lines match stock movements and FIFO cost layers.'),
    check('fixed_asset_links', assetMismatchIds.length, 0, assetMismatchIds, 'Fixed-asset ledger lines match the asset register.'),
    check('negative_inventory', negativeInventory.length, 0, negativeInventory, 'No inventory item has a negative balance.'),
    check('capital_ownership', sum([...capitalByOwnerMap.values()]), capitalReceived, [], 'Owner contribution detail equals total capital.'),
    check('cash_roll_forward', sum(accountBalances.map((account) => account.amount)), cashBalance, [], 'Named and unassigned cash reconcile to headline cash.'),
    check('balance_sheet', totalAssets, totalLiabilities + capitalReceived + retainedEarnings, [], 'Assets equal liabilities plus equity.'),
    check('audit_attribution', creatorlessIds.length, 0, creatorlessIds, 'Every active finance record identifies its creator.'),
    check('document_attachments', attachedRecords, spendingEntries.length, spendingEntries.filter((entry) => !entry.attachmentUrl).map((entry) => entry.recordKey ?? entry.id), 'Attachment coverage is disclosed separately and is not treated as external verification.', 0, true),
  ];
  const requiredChecks = checks.filter((row) => row.status !== 'WARNING');
  const passedChecks = requiredChecks.filter((row) => row.status === 'PASS').length;
  const internallyReconciled = requiredChecks.every((row) => row.status === 'PASS');
  const tracedRecords = spendingEntries.length - untracedIds.length;

  const statusRoles = new Map(orderStatusOptions.map((option) => [option.code, option.metricRole]));
  const salesOrders = orders.filter((order) => (
    order.purpose === 'SALE'
    && (statusRoles.get(order.status) ?? orderStatusRole(order.status)) === 'SALE'
  ));
  const baseline = {
    capitalReceived,
    totalSpending,
    paidSpending,
    outstandingPayable: totals.outstandingPayable,
    outstandingReceivable: totals.outstandingReceivable,
    cashBalance,
    inventoryPurchases,
    inventoryValue,
    fixedAssetPurchases,
    fixedAssetValue,
    operatingSpending,
    salesOrders: salesOrders.length,
    grossSales: sum(salesOrders.map((order) => Math.max(
      0,
      order.grossAmount -
        order.discountAmount -
        order.refundAmount +
        order.deliveryFee +
        order.extraCharges,
    ))),
    spendingRecords: spendingEntries.length,
    tracedRecords,
    attachedRecords,
    totalAssets,
    totalLiabilities,
    retainedEarnings,
  };
  const monthlySpending = [...monthly.entries()].map(([month, value]) => ({ month, ...value })).sort((a, b) => a.month.localeCompare(b.month));
  const spendingByClass: ShareholderReportData['spendingByClass'] = [
    { key: 'INVENTORY', amount: inventoryPurchases },
    { key: 'FIXED_ASSET', amount: fixedAssetPurchases },
    { key: 'OPERATING', amount: operatingSpending },
  ];
  const spendingByCategory = [...categoryTotals.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  const spendingBySupplier = [...supplierTotals.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  const capitalByOwner = [...capitalByOwnerMap.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  const normalizedAssets = fixedAssets.map((asset) => ({ ...asset, quantity: decimalNumber(asset.quantity) }));
  const hashPayload = {
    baseline,
    spendLines: spendLines.map((line) => ({ ...line, date: line.date.toISOString() })),
    monthlySpending,
    spendingByClass,
    spendingByCategory,
    spendingBySupplier,
    capitalByOwner,
    accountBalances,
    inventory,
    fixedAssets: normalizedAssets,
    checks,
  };

  return {
    generatedAt: new Date(),
    firstActivityAt: spendingEntries[0]?.date ?? entries[0]?.date ?? null,
    asOf,
    snapshotHash: stableHash(hashPayload),
    baseline,
    spendLines,
    monthlySpending,
    spendingByClass,
    spendingByCategory,
    spendingBySupplier,
    capitalByOwner,
    accountBalances,
    inventory,
    fixedAssets: normalizedAssets,
    checks,
    internallyReconciled,
    internalIntegrityPercent: requiredChecks.length ? (passedChecks / requiredChecks.length) * 100 : 100,
    traceabilityPercent: spendingEntries.length ? (tracedRecords / spendingEntries.length) * 100 : 100,
    attachmentCoveragePercent: spendingEntries.length ? (attachedRecords / spendingEntries.length) * 100 : 100,
  };
}
