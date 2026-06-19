'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db/client';
import { getCurrentUser } from '@/server/auth/session';
import { getUsdToIqd } from '@/server/settings';
import { audit, optField, reqField, type ActionState } from '@/server/records/shared';
import { can } from '@/lib/rbac';
import { toMinor, convertToIqd } from '@/lib/money';
import { parseDecimalInput } from '@/lib/decimal';
import { CURRENCIES, EXPENSE_CATEGORY_TYPES, INVENTORY_CATEGORIES, PARTY_TYPES, PAYMENT_METHODS } from '@/lib/enums';
import { ledgerUnitCostMinor } from '@/lib/ledger-lines';
import { ledgerRecordClassForLines } from '@/lib/ledger-record-class';
import { isMeasurementUnit } from '@/lib/units';
import { syncActiveCost } from '@/server/inventory/fifo';
import type { Currency, ExpenseCategoryType, FinanceType, ObligationKind, Prisma, Role } from '@prisma/client';

const FINANCE = '/[locale]/(dashboard)/finance';
const LEDGER = '/[locale]/(dashboard)/finance/ledger';
const DUES = '/[locale]/(dashboard)/finance/dues';
const INVENTORY = '/[locale]/(dashboard)/admin/records/inventory';
const AUDIT = '/[locale]/(dashboard)/admin/audit';

const RECORD_KINDS = [
  'MONEY_IN',
  'MONEY_OUT',
  'STOCK_PURCHASE',
  'ASSET_PURCHASE',
  'CUSTOMER_DUE',
  'SUPPLIER_DUE',
  'TRANSFER',
  'CAPITAL_IN',
  'DRAWING',
] as const;

type RecordKind = (typeof RECORD_KINDS)[number];
type Tx = Prisma.TransactionClient;

const LINE_TYPES = ['INVENTORY', 'ASSET', 'EXPENSE', 'SERVICE', 'OTHER'] as const;
type LedgerLineType = (typeof LINE_TYPES)[number];

const PURCHASE_PAYMENT_MODES = ['PAID', 'CREDIT', 'PARTIAL'] as const;
type PurchasePaymentMode = (typeof PURCHASE_PAYMENT_MODES)[number];

type MoneyShape = {
  amount: number;
  origCurrency: Currency | null;
  origAmount: number | null;
  fxRate: number | null;
};

type QuickCreateResult = { ok: true; id: string; label: string } | { ok: false; error: string };

type ParsedLedgerLine = {
  token: string;
  lineNo: number;
  itemType: LedgerLineType;
  itemName: string;
  categoryType: ExpenseCategoryType | null;
  assetKey: string | null;
  assetCategory: string | null;
  inventoryItemId: string | null;
  inventoryItemMode: 'existing' | 'new';
  newItemNameEn: string;
  newItemNameAr: string;
  newItemCategory: string;
  unit: string;
  quantity: number;
  unitCost: string;
  landedUnitCost: string;
  discountAmount: number;
  extraAmount: number;
  lineTotal: number;
  originalLineTotal: number;
  branchId: string | null;
  notes: string | null;
};

function isOwnerAdmin(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

async function requireFinanceUser() {
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'manage:finance')) return null;
  return user;
}

async function requireOwnerAdminUser() {
  const user = await getCurrentUser();
  if (!user || !isOwnerAdmin(user.role)) return null;
  return user;
}

function oneOf<T extends readonly string[]>(value: string, values: T): T[number] | null {
  return values.includes(value) ? (value as T[number]) : null;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseOptionalDate(value: string | undefined): Date | null {
  return value ? parseDate(value) : null;
}

async function parseMoney(fd: FormData): Promise<MoneyShape | null> {
  const currency = oneOf(reqField(fd, 'currency'), CURRENCIES);
  const amountMajor = Number(reqField(fd, 'amount'));
  if (!currency || !Number.isFinite(amountMajor) || amountMajor <= 0) return null;
  const origMinor = toMinor(amountMajor, currency);
  if (currency === 'IQD') {
    return { amount: origMinor, origCurrency: null, origAmount: null, fxRate: null };
  }
  const fallbackRate = await getUsdToIqd();
  const rate = Math.round(Number(optField(fd, 'rate') ?? fallbackRate));
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return {
    amount: convertToIqd(origMinor, currency, rate),
    origCurrency: currency,
    origAmount: origMinor,
    fxRate: rate,
  };
}

async function parseCurrencyShape(fd: FormData): Promise<{ currency: Currency; fxRate: number | null } | null> {
  const currency = oneOf(reqField(fd, 'currency'), CURRENCIES);
  if (!currency) return null;
  if (currency === 'IQD') return { currency, fxRate: null };
  const fallbackRate = await getUsdToIqd();
  const rate = Math.round(Number(optField(fd, 'rate') ?? fallbackRate));
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return { currency, fxRate: rate };
}

function parseMajorAmount(value: string | undefined, allowZero = true): number | null {
  if (!value) return allowZero ? 0 : null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  if (!allowZero && parsed <= 0) return null;
  return parsed;
}

function inputMajorToIqdMinor(amountMajor: number, currency: Currency, fxRate: number | null): number {
  const originalMinor = toMinor(amountMajor, currency);
  return convertToIqd(originalMinor, currency, fxRate ?? 1);
}

function parseLedgerLineTokens(fd: FormData): string[] {
  const raw = reqField(fd, 'lineIds');
  return raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function parsePurchasePaymentMode(fd: FormData): PurchasePaymentMode {
  return oneOf(reqField(fd, 'paymentMode') || 'PAID', PURCHASE_PAYMENT_MODES) ?? 'PAID';
}

function parsePaymentMethod(fd: FormData): string | null {
  const method = reqField(fd, 'paymentMethod');
  return PAYMENT_METHODS.includes(method as (typeof PAYMENT_METHODS)[number]) ? method : null;
}

async function parseLedgerLines(fd: FormData): Promise<{ lines: ParsedLedgerLine[]; money: MoneyShape } | null> {
  const currencyShape = await parseCurrencyShape(fd);
  if (!currencyShape) return null;
  const tokens = parseLedgerLineTokens(fd);
  if (!tokens.length) return null;

  const lines: ParsedLedgerLine[] = [];
  let total = 0;
  let originalTotal = 0;
  let lineNo = 1;

  for (const token of tokens) {
    const prefix = `line_${token}_`;
    const itemType = oneOf(reqField(fd, `${prefix}type`) || 'EXPENSE', LINE_TYPES);
    const unit = reqField(fd, `${prefix}unit`) || 'unit';
    const quantity = parseDecimalInput(reqField(fd, `${prefix}quantity`), 3);
    const unitCostMajor = parseMajorAmount(reqField(fd, `${prefix}unitCost`), false);
    if (!itemType || !isMeasurementUnit(unit) || quantity == null || quantity <= 0 || unitCostMajor == null) return null;

    const discountMajor = parseMajorAmount(optField(fd, `${prefix}discount`), true);
    const extraMajor = parseMajorAmount(optField(fd, `${prefix}extra`), true);
    if (discountMajor == null || extraMajor == null) return null;

    const lineMajor = Math.max(0, quantity * unitCostMajor - discountMajor + extraMajor);
    const originalLineTotal = toMinor(lineMajor, currencyShape.currency);
    const lineTotal = convertToIqd(originalLineTotal, currencyShape.currency, currencyShape.fxRate ?? 1);
    const discountAmount = inputMajorToIqdMinor(discountMajor, currencyShape.currency, currencyShape.fxRate);
    const extraAmount = inputMajorToIqdMinor(extraMajor, currencyShape.currency, currencyShape.fxRate);
    const categoryType = oneOf(reqField(fd, `${prefix}categoryType`), EXPENSE_CATEGORY_TYPES);
    const inventoryItemMode = reqField(fd, `${prefix}inventoryItemMode`) === 'new' ? 'new' : 'existing';

    lines.push({
      token,
      lineNo,
      itemType,
      itemName: reqField(fd, `${prefix}itemName`),
      categoryType,
      assetKey: optField(fd, `${prefix}assetKey`) ?? null,
      assetCategory: optField(fd, `${prefix}assetCategory`) ?? null,
      inventoryItemId: optField(fd, `${prefix}inventoryItemId`) ?? null,
      inventoryItemMode,
      newItemNameEn: reqField(fd, `${prefix}newItemNameEn`),
      newItemNameAr: reqField(fd, `${prefix}newItemNameAr`),
      newItemCategory: reqField(fd, `${prefix}newItemCategory`),
      unit,
      quantity,
      unitCost: inputMajorToIqdMinor(unitCostMajor, currencyShape.currency, currencyShape.fxRate).toFixed(3),
      landedUnitCost: ledgerUnitCostMinor(lineTotal, quantity),
      discountAmount,
      extraAmount,
      lineTotal,
      originalLineTotal,
      branchId: optField(fd, `${prefix}branchId`) ?? optField(fd, 'branchId') ?? null,
      notes: optField(fd, `${prefix}notes`) ?? null,
    });
    total += lineTotal;
    originalTotal += originalLineTotal;
    lineNo += 1;
  }

  if (total <= 0) return null;
  return {
    lines,
    money: {
      amount: total,
      origCurrency: currencyShape.currency === 'IQD' ? null : currencyShape.currency,
      origAmount: currencyShape.currency === 'IQD' ? null : originalTotal,
      fxRate: currencyShape.fxRate,
    },
  };
}

function parseQuantity(fd: FormData, field = 'quantity'): number | null {
  const parsed = parseDecimalInput(reqField(fd, field), 3);
  return parsed != null && parsed > 0 ? parsed : null;
}

function decimalData(value: number): string {
  return value.toFixed(3);
}

function unitCostData(totalMinor: number, quantity: number): string {
  return (totalMinor / quantity).toFixed(3);
}

function categoryForInventory(category: string) {
  if (category === 'GREEN_COFFEE') return 'GREEN_COFFEE' as const;
  if (category === 'PACKAGING') return 'PACKAGING' as const;
  if (category === 'ACCESSORY') return 'EQUIPMENT' as const;
  return null;
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return null as unknown as Prisma.InputJsonValue;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'object' && 'toString' in value && value.constructor?.name === 'Decimal') {
    return value.toString();
  }
  if (Array.isArray(value)) return value.map(jsonSafe) as Prisma.InputJsonArray;
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, jsonSafe(entry)]),
    ) as Prisma.InputJsonObject;
  }
  return String(value);
}

function revalidateFinancePaths(): void {
  revalidatePath(FINANCE, 'page');
  revalidatePath(LEDGER, 'page');
  revalidatePath(DUES, 'page');
  revalidatePath(INVENTORY, 'page');
  revalidatePath(AUDIT, 'page');
}

function baseEntryData(
  fd: FormData,
  date: Date,
  money: MoneyShape,
  type: FinanceType,
  obligation: boolean,
  obligationKind: ObligationKind | null,
) {
  return {
    date,
    type,
    amount: money.amount,
    currency: 'IQD' as const,
    origCurrency: money.origCurrency,
    origAmount: money.origAmount,
    fxRate: money.fxRate,
    obligation,
    obligationKind,
    dueDate: obligation ? parseOptionalDate(optField(fd, 'dueDate')) ?? date : null,
    accountId: obligation ? null : optField(fd, 'accountId') ?? null,
    toAccountId: type === 'TRANSFER' ? optField(fd, 'toAccountId') ?? null : null,
    partyId: optField(fd, 'partyId') ?? null,
    categoryType: oneOf(optField(fd, 'categoryType') ?? '', EXPENSE_CATEGORY_TYPES),
    branchId: optField(fd, 'branchId') ?? null,
    description: optField(fd, 'description') ?? null,
    reference: optField(fd, 'reference') ?? null,
    attachmentUrl: optField(fd, 'attachmentUrl') ?? null,
  };
}

async function resolveInventoryItem(
  tx: Tx,
  fd: FormData,
  userId: string,
  unitCost: string,
): Promise<{ id: string; category: string; branchId: string | null } | null> {
  const mode = reqField(fd, 'inventoryItemMode') || 'existing';
  if (mode === 'existing') {
    const id = reqField(fd, 'inventoryItemId');
    if (!id) return null;
    const item = await tx.inventoryItem.findUnique({
      where: { id },
      select: { id: true, category: true, branchId: true },
    });
    return item;
  }

  const nameEn = reqField(fd, 'newItemNameEn');
  const nameAr = reqField(fd, 'newItemNameAr') || nameEn;
  const category = oneOf(reqField(fd, 'newItemCategory'), INVENTORY_CATEGORIES);
  const unit = reqField(fd, 'unit');
  if (!nameEn || !category || !isMeasurementUnit(unit)) return null;
  const reorderPoint = optField(fd, 'newItemReorderPoint');
  const branchId = optField(fd, 'branchId') ?? null;
  const created = await tx.inventoryItem.create({
    data: {
      nameEn,
      nameAr,
      category,
      unit,
      branchId,
      unitCost,
      reorderPoint: reorderPoint ? decimalData(parseDecimalInput(reorderPoint, 3) ?? 0) : null,
    },
    select: { id: true, category: true, branchId: true },
  });
  await tx.auditLog.create({
    data: {
      userId,
      action: 'CREATE',
      entity: 'InventoryItem',
      entityId: created.id,
      metadata: { source: 'central-ledger-panel', nameEn, nameAr, category, unit },
    },
  });
  return created;
}

async function resolveLineInventoryItem(
  tx: Tx,
  line: ParsedLedgerLine,
  userId: string,
): Promise<{ id: string; category: string; branchId: string | null; nameEn: string; nameAr: string; unit: string } | null> {
  if (line.inventoryItemMode === 'existing') {
    if (!line.inventoryItemId) return null;
    return tx.inventoryItem.findUnique({
      where: { id: line.inventoryItemId },
      select: { id: true, category: true, branchId: true, nameEn: true, nameAr: true, unit: true },
    });
  }

  const category = oneOf(line.newItemCategory, INVENTORY_CATEGORIES);
  const nameEn = line.newItemNameEn || line.itemName;
  const nameAr = line.newItemNameAr || nameEn;
  if (!nameEn || !category || !isMeasurementUnit(line.unit)) return null;
  const created = await tx.inventoryItem.create({
    data: {
      nameEn,
      nameAr,
      category,
      unit: line.unit,
      branchId: line.branchId,
      unitCost: line.landedUnitCost,
    },
    select: { id: true, category: true, branchId: true, nameEn: true, nameAr: true, unit: true },
  });
  await tx.auditLog.create({
    data: {
      userId,
      action: 'CREATE',
      entity: 'InventoryItem',
      entityId: created.id,
      metadata: { source: 'multi-item-ledger-line', nameEn, nameAr, category, unit: line.unit },
    },
  });
  return created;
}

function overallCategory(lines: ParsedLedgerLine[]): ExpenseCategoryType | null {
  const categories = new Set(lines.map((line) => line.categoryType).filter(Boolean));
  return categories.size === 1 ? ([...categories][0] as ExpenseCategoryType) : null;
}

async function nextCustomerCode(tx: Tx): Promise<string> {
  const rows = await tx.customer.findMany({ select: { externalId: true } });
  let max = 0;
  for (const { externalId } of rows) {
    const match = externalId?.match(/^CL-0*(\d+)$/i);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `CL-${String(max + 1).padStart(6, '0')}`;
}

export async function quickCreateParty(fd: FormData): Promise<QuickCreateResult> {
  const user = await requireFinanceUser();
  if (!user) return { ok: false, error: 'forbidden' };
  const name = reqField(fd, 'name');
  const type = oneOf(reqField(fd, 'type') || 'SUPPLIER', PARTY_TYPES);
  if (!name || !type) return { ok: false, error: 'invalid' };
  const row = await prisma.party.create({
    data: {
      name,
      type,
      phone: optField(fd, 'phone') ?? null,
      email: optField(fd, 'email') ?? null,
      address: optField(fd, 'address') ?? null,
      notes: optField(fd, 'notes') ?? null,
    },
    select: { id: true, name: true },
  });
  await audit(user.id, 'CREATE', 'Party', { id: row.id, name: row.name, source: 'central-ledger-popup' });
  revalidateFinancePaths();
  return { ok: true, id: row.id, label: row.name };
}

export async function quickCreateCustomer(fd: FormData): Promise<QuickCreateResult> {
  const user = await requireFinanceUser();
  if (!user) return { ok: false, error: 'forbidden' };
  const name = reqField(fd, 'name');
  if (!name) return { ok: false, error: 'invalid' };
  const result = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        externalId: await nextCustomerCode(tx),
        nameEn: name,
        nameAr: optField(fd, 'nameAr') ?? name,
        phone: optField(fd, 'phone') ?? null,
        email: optField(fd, 'email') ?? null,
        address1: optField(fd, 'address') ?? null,
        notes: optField(fd, 'notes') ?? null,
        segment: 'NEW',
      },
      select: { id: true, externalId: true },
    });
    const party = await tx.party.create({
      data: {
        name,
        type: 'CUSTOMER',
        phone: optField(fd, 'phone') ?? null,
        email: optField(fd, 'email') ?? null,
        address: optField(fd, 'address') ?? null,
        notes: `Linked customer ${customer.externalId}`,
      },
      select: { id: true, name: true },
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'CREATE',
        entity: 'Customer',
        entityId: customer.id,
        metadata: { externalId: customer.externalId, partyId: party.id, source: 'central-ledger-popup' },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'CREATE',
        entity: 'Party',
        entityId: party.id,
        metadata: { name: party.name, type: 'CUSTOMER', customerId: customer.id, source: 'central-ledger-popup' },
      },
    });
    return party;
  });
  revalidateFinancePaths();
  return { ok: true, id: result.id, label: result.name };
}

export async function createCentralRecord(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireFinanceUser();
  if (!user) return { error: 'forbidden' };
  const locale = reqField(fd, 'locale') || 'ar';
  const kind = oneOf(reqField(fd, 'recordKind'), RECORD_KINDS);
  const date = parseDate(reqField(fd, 'date'));
  if (!kind || !date) return { error: 'invalid' };

  const lineTokens = parseLedgerLineTokens(fd);
  const isMultiLinePurchase = kind === 'STOCK_PURCHASE' && lineTokens.length > 0;
  const linePayload = isMultiLinePurchase ? await parseLedgerLines(fd) : null;
  const money = isMultiLinePurchase ? linePayload?.money ?? null : await parseMoney(fd);
  if (!money || money.amount <= 0) return { error: 'invalid' };

  const quantity = kind === 'STOCK_PURCHASE' || kind === 'ASSET_PURCHASE' ? parseQuantity(fd) : null;
  if (!isMultiLinePurchase && (kind === 'STOCK_PURCHASE' || kind === 'ASSET_PURCHASE') && !quantity) return { error: 'invalid' };

  const paidMode = parsePurchasePaymentMode(fd);
  const payable = paidMode !== 'PAID';
  const needsPaymentAccount = (kind === 'STOCK_PURCHASE' || kind === 'ASSET_PURCHASE') && (paidMode === 'PAID' || paidMode === 'PARTIAL');
  if (needsPaymentAccount && !optField(fd, 'accountId')) {
    return { error: 'invalid' };
  }
  const paidAmountMajor = parseMajorAmount(optField(fd, 'paidAmount'), true);
  const currencyShape = await parseCurrencyShape(fd);
  const paidAmount = paidMode === 'PAID'
    ? money.amount
    : paidMode === 'PARTIAL' && paidAmountMajor != null && currencyShape
      ? inputMajorToIqdMinor(paidAmountMajor, currencyShape.currency, currencyShape.fxRate)
      : 0;
  if (paidMode === 'PARTIAL' && (paidAmount <= 0 || paidAmount >= money.amount)) return { error: 'invalid' };

  let newId = '';
  const touchedItems: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
    if (isMultiLinePurchase && linePayload) {
      const paymentMethod = parsePaymentMethod(fd);
      const entry = await tx.financeEntry.create({
        data: {
          ...baseEntryData(fd, date, money, 'PURCHASE', payable, payable ? 'PAYABLE' : null),
          recordClass: ledgerRecordClassForLines(linePayload.lines),
          accountId: paidMode === 'PAID' ? optField(fd, 'accountId') ?? null : null,
          categoryType: overallCategory(linePayload.lines),
          paymentMethod: paidMode === 'CREDIT' ? 'CREDIT' : paymentMethod,
          createdById: user.id,
          description: optField(fd, 'description') ?? 'Vendor invoice / purchase',
        },
        select: { id: true },
      });

      for (const line of linePayload.lines) {
        let inventoryItemId = line.inventoryItemId;
        let categoryType = line.categoryType;
        let itemName = line.itemName;
        if (line.itemType === 'INVENTORY') {
          const item = await resolveLineInventoryItem(tx, line, user.id);
          if (!item) throw new Error('invalid-line-item');
          inventoryItemId = item.id;
          categoryType = categoryForInventory(item.category);
          itemName = itemName || item.nameEn;
          await tx.inventoryCostLayer.create({
            data: {
              inventoryItemId: item.id,
              financeEntryId: entry.id,
              qtyReceived: decimalData(line.quantity),
              unitCost: line.landedUnitCost,
              receivedAt: date,
            },
          });
          await tx.stockMovement.create({
            data: {
              inventoryItemId: item.id,
              financeEntryId: entry.id,
              occurredAt: date,
              reason: 'PURCHASE',
              quantity: decimalData(line.quantity),
              reference: optField(fd, 'reference') ?? null,
              branchId: line.branchId ?? item.branchId,
            },
          });
          touchedItems.push(item.id);
        } else if (line.itemType === 'ASSET') {
          categoryType = 'EQUIPMENT';
        } else if (!categoryType) {
          categoryType = 'OVERHEAD';
        }
        if (!itemName) throw new Error('invalid-line-name');
        await tx.ledgerEntryLine.create({
          data: {
            financeEntryId: entry.id,
            lineNo: line.lineNo,
            itemType: line.itemType,
            itemName,
            assetKey: line.assetKey,
            assetCategory: line.assetCategory,
            categoryType,
            inventoryItemId,
            unit: line.unit,
            quantity: decimalData(line.quantity),
            unitCost: line.unitCost,
            landedUnitCost: line.landedUnitCost,
            discountAmount: line.discountAmount,
            extraAmount: line.extraAmount,
            lineTotal: line.lineTotal,
            branchId: line.branchId,
            notes: line.notes,
          },
        });
        if (line.itemType === 'ASSET') {
          await tx.fixedAsset.create({
            data: {
              name: itemName,
              category: line.assetCategory ?? 'Equipment',
              quantity: decimalData(line.quantity),
              unit: line.unit,
              totalCost: line.lineTotal,
              unitCost: line.landedUnitCost,
              purchaseDate: date,
              partyId: optField(fd, 'partyId') ?? null,
              branchId: line.branchId,
              financeEntryId: entry.id,
              notes: line.notes,
              createdById: user.id,
            },
          });
        }
      }

      if (paidMode === 'PARTIAL') {
        await tx.financeEntry.create({
          data: {
            date: parseOptionalDate(optField(fd, 'paymentDate')) ?? date,
            type: 'PAYMENT_OUT',
            amount: paidAmount,
            currency: 'IQD',
            obligation: false,
            accountId: optField(fd, 'accountId') ?? null,
            partyId: optField(fd, 'partyId') ?? null,
            categoryType: overallCategory(linePayload.lines),
            paymentMethod,
            settlesId: entry.id,
            branchId: optField(fd, 'branchId') ?? null,
            description: `Payment for ${optField(fd, 'reference') ?? entry.id.slice(-8)}`,
            reference: optField(fd, 'reference') ?? null,
            createdById: user.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'CREATE',
          entity: 'FinanceEntry',
          entityId: entry.id,
          metadata: {
            source: 'multi-item-ledger-panel',
            kind,
            lines: linePayload.lines.map((line) => ({
              lineNo: line.lineNo,
              itemType: line.itemType,
              itemName: line.itemName,
              quantity: decimalData(line.quantity),
              unit: line.unit,
              lineTotal: line.lineTotal,
            })),
            total: money.amount,
            paidAmount,
            paymentMode: paidMode,
          },
        },
      });
      newId = entry.id;
      return;
    }

    if (kind === 'STOCK_PURCHASE') {
      const qty = quantity as number;
      const unit = reqField(fd, 'unit');
      if (!isMeasurementUnit(unit)) throw new Error('invalid-unit');
      const unitCost = unitCostData(money.amount, qty);
      const item = await resolveInventoryItem(tx, fd, user.id, unitCost);
      if (!item) throw new Error('invalid-item');
      const paymentMethod = parsePaymentMethod(fd);
      const entry = await tx.financeEntry.create({
        data: {
          ...baseEntryData(fd, date, money, 'PURCHASE', payable, payable ? 'PAYABLE' : null),
          recordClass: 'PURCHASE',
          accountId: paidMode === 'PAID' ? optField(fd, 'accountId') ?? null : null,
          categoryType: categoryForInventory(item.category),
          paymentMethod: paidMode === 'CREDIT' ? 'CREDIT' : paymentMethod,
          branchId: optField(fd, 'branchId') ?? item.branchId,
          createdById: user.id,
          description: optField(fd, 'description') ?? 'Bought stock',
        },
        select: { id: true },
      });
      await tx.inventoryCostLayer.create({
        data: {
          inventoryItemId: item.id,
          financeEntryId: entry.id,
          qtyReceived: decimalData(qty),
          unitCost,
          receivedAt: date,
        },
      });
      await tx.stockMovement.create({
        data: {
          inventoryItemId: item.id,
          financeEntryId: entry.id,
          occurredAt: date,
          reason: 'PURCHASE',
          quantity: decimalData(qty),
          reference: optField(fd, 'reference') ?? null,
          expiryDate: parseOptionalDate(optField(fd, 'expiryDate')),
          branchId: optField(fd, 'branchId') ?? item.branchId,
        },
      });
      if (paidMode === 'PARTIAL') {
        await tx.financeEntry.create({
          data: {
            date: parseOptionalDate(optField(fd, 'paymentDate')) ?? date,
            type: 'PAYMENT_OUT',
            amount: paidAmount,
            currency: 'IQD',
            obligation: false,
            accountId: optField(fd, 'accountId') ?? null,
            partyId: optField(fd, 'partyId') ?? null,
            categoryType: categoryForInventory(item.category),
            paymentMethod,
            settlesId: entry.id,
            branchId: optField(fd, 'branchId') ?? item.branchId,
            description: `Payment for ${optField(fd, 'reference') ?? entry.id.slice(-8)}`,
            reference: optField(fd, 'reference') ?? null,
            createdById: user.id,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'CREATE',
          entity: 'FinanceEntry',
          entityId: entry.id,
          metadata: {
            source: 'central-ledger-panel',
            kind,
            inventoryItemId: item.id,
            quantity: decimalData(qty),
            unit,
            totalCost: money.amount,
            unitCost,
          },
        },
      });
      newId = entry.id;
      touchedItems.push(item.id);
      return;
    }

    if (kind === 'ASSET_PURCHASE') {
      const qty = quantity as number;
      const unit = reqField(fd, 'unit');
      const name = reqField(fd, 'assetName');
      const category = reqField(fd, 'assetCategory') || 'Equipment';
      if (!name || !isMeasurementUnit(unit)) throw new Error('invalid-asset');
      const unitCost = unitCostData(money.amount, qty);
      const paymentMethod = parsePaymentMethod(fd);
      const entry = await tx.financeEntry.create({
        data: {
          ...baseEntryData(fd, date, money, 'PURCHASE', payable, payable ? 'PAYABLE' : null),
          recordClass: 'PURCHASE',
          accountId: paidMode === 'PAID' ? optField(fd, 'accountId') ?? null : null,
          categoryType: 'EQUIPMENT',
          paymentMethod: paidMode === 'CREDIT' ? 'CREDIT' : paymentMethod,
          createdById: user.id,
          description: optField(fd, 'description') ?? `Bought equipment: ${name}`,
        },
        select: { id: true },
      });
      const asset = await tx.fixedAsset.create({
        data: {
          name,
          category,
          quantity: decimalData(qty),
          unit,
          totalCost: money.amount,
          unitCost,
          purchaseDate: date,
          partyId: optField(fd, 'partyId') ?? null,
          branchId: optField(fd, 'branchId') ?? null,
          financeEntryId: entry.id,
          notes: optField(fd, 'description') ?? null,
          createdById: user.id,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'CREATE',
          entity: 'FixedAsset',
          entityId: asset.id,
          metadata: { source: 'central-ledger-panel', financeEntryId: entry.id, name, quantity: decimalData(qty), unit, totalCost: money.amount, unitCost },
        },
      });
      if (paidMode === 'PARTIAL') {
        await tx.financeEntry.create({
          data: {
            date: parseOptionalDate(optField(fd, 'paymentDate')) ?? date,
            type: 'PAYMENT_OUT',
            amount: paidAmount,
            currency: 'IQD',
            obligation: false,
            accountId: optField(fd, 'accountId') ?? null,
            partyId: optField(fd, 'partyId') ?? null,
            categoryType: 'EQUIPMENT',
            paymentMethod,
            settlesId: entry.id,
            branchId: optField(fd, 'branchId') ?? null,
            description: `Payment for ${optField(fd, 'reference') ?? entry.id.slice(-8)}`,
            reference: optField(fd, 'reference') ?? null,
            createdById: user.id,
          },
        });
      }
      newId = entry.id;
      return;
    }

    const map: Record<Exclude<RecordKind, 'STOCK_PURCHASE' | 'ASSET_PURCHASE'>, { type: FinanceType; obligation: boolean; kind: ObligationKind | null }> = {
      MONEY_IN: { type: 'INCOME', obligation: false, kind: null },
      MONEY_OUT: { type: 'EXPENSE', obligation: false, kind: null },
      CUSTOMER_DUE: { type: 'INCOME', obligation: true, kind: 'RECEIVABLE' },
      SUPPLIER_DUE: { type: 'PURCHASE', obligation: true, kind: 'PAYABLE' },
      TRANSFER: { type: 'TRANSFER', obligation: false, kind: null },
      CAPITAL_IN: { type: 'CAPITAL_IN', obligation: false, kind: null },
      DRAWING: { type: 'DRAWING', obligation: false, kind: null },
    };
    const mapped = map[kind];
    if (!mapped) throw new Error('invalid-kind');
    if (mapped.type === 'TRANSFER') {
      const from = optField(fd, 'accountId');
      const to = optField(fd, 'toAccountId');
      if (!from || !to || from === to) throw new Error('invalid-transfer');
    } else if (!mapped.obligation && !optField(fd, 'accountId')) {
      throw new Error('invalid-account');
    }
    if (mapped.obligation && !optField(fd, 'partyId')) throw new Error('invalid-party');
    const entry = await tx.financeEntry.create({
      data: {
        ...baseEntryData(fd, date, money, mapped.type, mapped.obligation, mapped.kind),
        recordClass: mapped.type === 'EXPENSE' ? 'EXPENSE' : mapped.type === 'PURCHASE' ? 'PURCHASE' : null,
        createdById: user.id,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'CREATE',
        entity: 'FinanceEntry',
        entityId: entry.id,
        metadata: { source: 'central-ledger-panel', kind, amount: money.amount },
      },
    });
    newId = entry.id;
    });
  } catch {
    return { error: 'invalid' };
  }

  for (const itemId of touchedItems) await syncActiveCost(itemId);
  revalidateFinancePaths();
  redirect(`/${locale}/finance/ledger/${newId}`);
}

export async function updateCentralPurchase(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireOwnerAdminUser();
  if (!user) return { error: 'forbidden' };
  const locale = reqField(fd, 'locale') || 'ar';
  const date = parseDate(reqField(fd, 'date'));
  const payload = await parseLedgerLines(fd);
  const changeReason = reqField(fd, 'changeReason');
  if (!date || !payload || !changeReason) return { error: 'invalid' };

  const paidMode = parsePurchasePaymentMode(fd);
  const paymentMethod = parsePaymentMethod(fd);
  const paidAmountMajor = parseMajorAmount(optField(fd, 'paidAmount'), true);
  const currencyShape = await parseCurrencyShape(fd);
  const paidAmount = paidMode === 'PAID'
    ? payload.money.amount
    : paidMode === 'PARTIAL' && paidAmountMajor != null && currencyShape
      ? inputMajorToIqdMinor(paidAmountMajor, currencyShape.currency, currencyShape.fxRate)
      : 0;
  if (paidMode === 'PARTIAL' && (paidAmount <= 0 || paidAmount >= payload.money.amount)) return { error: 'invalid' };
  if (paidMode !== 'CREDIT' && !optField(fd, 'accountId')) return { error: 'invalid' };

  const touchedItems = new Set<string>();
  try {
    await prisma.$transaction(async (tx) => {
      const before = await entrySnapshot(tx, id);
      if (!before || before.type !== 'PURCHASE') throw new Error('invalid-entry');
      before.stockMovements.forEach((movement) => touchedItems.add(movement.inventoryItemId));

      await tx.inventoryCostLayer.deleteMany({ where: { financeEntryId: id } });
      await tx.stockMovement.deleteMany({ where: { financeEntryId: id } });
      await tx.fixedAsset.deleteMany({ where: { financeEntryId: id } });
      await tx.ledgerEntryLine.deleteMany({ where: { financeEntryId: id } });

      await tx.financeEntry.update({
        where: { id },
        data: {
          date,
          amount: payload.money.amount,
          origCurrency: payload.money.origCurrency,
          origAmount: payload.money.origAmount,
          fxRate: payload.money.fxRate,
          recordClass: ledgerRecordClassForLines(payload.lines),
          obligation: paidMode !== 'PAID',
          obligationKind: paidMode !== 'PAID' ? 'PAYABLE' : null,
          dueDate: paidMode !== 'PAID' ? parseOptionalDate(optField(fd, 'dueDate')) ?? date : null,
          accountId: paidMode === 'PAID' ? optField(fd, 'accountId') ?? null : null,
          partyId: optField(fd, 'partyId') ?? null,
          categoryType: overallCategory(payload.lines),
          paymentMethod: paidMode === 'CREDIT' ? 'CREDIT' : paymentMethod,
          branchId: optField(fd, 'branchId') ?? null,
          description: optField(fd, 'description') ?? null,
          reference: optField(fd, 'reference') ?? null,
          attachmentUrl: optField(fd, 'attachmentUrl') ?? null,
        },
      });

      for (const line of payload.lines) {
        let inventoryItemId: string | null = null;
        let categoryType = line.categoryType;
        let itemName = line.itemName;
        if (line.itemType === 'INVENTORY') {
          const item = await resolveLineInventoryItem(tx, line, user.id);
          if (!item) throw new Error('invalid-inventory-line');
          inventoryItemId = item.id;
          categoryType = categoryForInventory(item.category);
          itemName ||= item.nameEn;
          touchedItems.add(item.id);
          await tx.inventoryCostLayer.create({
            data: {
              inventoryItemId: item.id,
              financeEntryId: id,
              qtyReceived: decimalData(line.quantity),
              unitCost: line.landedUnitCost,
              receivedAt: date,
            },
          });
          await tx.stockMovement.create({
            data: {
              inventoryItemId: item.id,
              financeEntryId: id,
              occurredAt: date,
              reason: 'PURCHASE',
              quantity: decimalData(line.quantity),
              reference: optField(fd, 'reference') ?? null,
              branchId: line.branchId ?? item.branchId,
            },
          });
        } else if (line.itemType === 'ASSET') {
          categoryType = 'EQUIPMENT';
        } else if (!categoryType) {
          categoryType = 'OVERHEAD';
        }
        if (!itemName) throw new Error('invalid-line-name');

        await tx.ledgerEntryLine.create({
          data: {
            financeEntryId: id,
            lineNo: line.lineNo,
            itemType: line.itemType,
            itemName,
            assetKey: line.assetKey,
            assetCategory: line.assetCategory,
            categoryType,
            inventoryItemId,
            unit: line.unit,
            quantity: decimalData(line.quantity),
            unitCost: line.unitCost,
            landedUnitCost: line.landedUnitCost,
            discountAmount: line.discountAmount,
            extraAmount: line.extraAmount,
            lineTotal: line.lineTotal,
            branchId: line.branchId,
            notes: line.notes,
          },
        });

        if (line.itemType === 'ASSET') {
          await tx.fixedAsset.create({
            data: {
              name: itemName,
              category: line.assetCategory ?? 'Equipment',
              quantity: decimalData(line.quantity),
              unit: line.unit,
              totalCost: line.lineTotal,
              unitCost: line.landedUnitCost,
              purchaseDate: date,
              partyId: optField(fd, 'partyId') ?? null,
              branchId: line.branchId,
              financeEntryId: id,
              notes: line.notes,
              createdById: user.id,
            },
          });
        }
      }

      const settlements = before.settlements.filter((row) => !row.archivedAt && !row.reversedAt && !row.reversalOfId);
      if (paidMode === 'PARTIAL') {
        const settlementData = {
          date: parseOptionalDate(optField(fd, 'paymentDate')) ?? date,
          type: 'PAYMENT_OUT' as const,
          amount: paidAmount,
          currency: 'IQD' as const,
          obligation: false,
          accountId: optField(fd, 'accountId') ?? null,
          partyId: optField(fd, 'partyId') ?? null,
          categoryType: overallCategory(payload.lines),
          paymentMethod,
          branchId: optField(fd, 'branchId') ?? null,
          description: `Payment for ${optField(fd, 'reference') ?? id.slice(-8)}`,
          reference: optField(fd, 'reference') ?? null,
          createdById: user.id,
        };
        if (settlements[0]) {
          await tx.financeEntry.update({ where: { id: settlements[0].id }, data: settlementData });
        } else {
          await tx.financeEntry.create({ data: { ...settlementData, settlesId: id } });
        }
        if (settlements.length > 1) {
          await tx.financeEntry.updateMany({
            where: { id: { in: settlements.slice(1).map((row) => row.id) } },
            data: { archivedAt: new Date(), archivedById: user.id, archiveReason: 'Consolidated during invoice edit' },
          });
        }
      } else if (settlements.length) {
        await tx.financeEntry.updateMany({
          where: { id: { in: settlements.map((row) => row.id) } },
          data: { archivedAt: new Date(), archivedById: user.id, archiveReason: 'Payment status changed during invoice edit' },
        });
      }

      const after = await entrySnapshot(tx, id);
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'UPDATE',
          entity: 'FinanceEntry',
          entityId: id,
          metadata: {
            source: 'multi-item-ledger-editor',
            reason: changeReason,
            before: jsonSafe(before),
            after: jsonSafe(after),
          },
        },
      });
    }, { timeout: 60_000 });
  } catch {
    return { error: 'invalid' };
  }

  for (const itemId of touchedItems) await syncActiveCost(itemId);
  revalidateFinancePaths();
  redirect(`/${locale}/finance/ledger/${id}`);
}

async function entrySnapshot(tx: Tx, id: string) {
  return tx.financeEntry.findUnique({
    where: { id },
    include: {
      ledgerLines: true,
      stockMovements: true,
      costLayers: true,
      fixedAssets: true,
      settlements: true,
    },
  });
}

export async function archiveFinanceEntry(id: string, locale: string, active: boolean): Promise<void> {
  const user = await requireOwnerAdminUser();
  if (!user) return;
  const snapshot = await prisma.financeEntry.findUnique({
    where: { id },
    include: { fixedAssets: true },
  });
  if (!snapshot) redirect(`/${locale}/finance/ledger`);
  const archivedAt = active ? null : new Date();
  await prisma.$transaction(async (tx) => {
    await tx.financeEntry.update({
      where: { id },
      data: {
        archivedAt,
        archivedById: active ? null : user.id,
        archiveReason: active ? null : 'Archived by Owner/Admin',
      },
    });
    for (const asset of snapshot.fixedAssets) {
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: {
          isActive: active,
          archivedAt,
          archivedById: active ? null : user.id,
          archiveReason: active ? null : 'Linked finance record archived',
        },
      });
    }
  });
  await audit(user.id, active ? 'RESTORE' : 'ARCHIVE', 'FinanceEntry', {
    id,
    before: jsonSafe(snapshot),
  });
  revalidateFinancePaths();
  redirect(`/${locale}/finance/ledger/${id}`);
}

export async function permanentlyDeleteFinanceEntry(id: string, locale: string): Promise<void> {
  const user = await requireOwnerAdminUser();
  if (!user) return;
  const touchedItems: string[] = [];
  const snapshot = await prisma.$transaction(async (tx) => {
    const before = await entrySnapshot(tx, id);
    if (!before) return null;
    touchedItems.push(...before.stockMovements.map((m) => m.inventoryItemId));
    await tx.fixedAsset.deleteMany({ where: { financeEntryId: id } });
    await tx.inventoryCostLayer.deleteMany({ where: { financeEntryId: id } });
    await tx.stockMovement.deleteMany({ where: { financeEntryId: id } });
    await tx.financeEntry.deleteMany({ where: { settlesId: id } });
    await tx.financeEntry.deleteMany({ where: { reversalOfId: id } });
    await tx.financeEntry.delete({ where: { id } });
    return before;
  });
  if (!snapshot) redirect(`/${locale}/finance/ledger`);
  for (const itemId of [...new Set(touchedItems)]) await syncActiveCost(itemId);
  await audit(user.id, 'DELETE', 'FinanceEntry', {
    id,
    permanent: true,
    before: jsonSafe(snapshot),
  });
  revalidateFinancePaths();
  redirect(`/${locale}/finance/ledger`);
}
