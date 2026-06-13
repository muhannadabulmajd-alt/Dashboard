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
import { CURRENCIES, EXPENSE_CATEGORY_TYPES, INVENTORY_CATEGORIES, PARTY_TYPES } from '@/lib/enums';
import { isMeasurementUnit } from '@/lib/units';
import { syncActiveCost } from '@/server/inventory/fifo';
import type { Currency, FinanceType, ObligationKind, Prisma, Role } from '@prisma/client';

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

type MoneyShape = {
  amount: number;
  origCurrency: Currency | null;
  origAmount: number | null;
  fxRate: number | null;
};

type QuickCreateResult = { ok: true; id: string; label: string } | { ok: false; error: string };

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
  const money = await parseMoney(fd);
  if (!kind || !date || !money || money.amount <= 0) return { error: 'invalid' };

  const quantity = kind === 'STOCK_PURCHASE' || kind === 'ASSET_PURCHASE' ? parseQuantity(fd) : null;
  if ((kind === 'STOCK_PURCHASE' || kind === 'ASSET_PURCHASE') && !quantity) return { error: 'invalid' };

  const paidMode = reqField(fd, 'paymentMode') || 'PAID';
  const payable = paidMode === 'CREDIT';
  if ((kind === 'STOCK_PURCHASE' || kind === 'ASSET_PURCHASE') && !payable && !optField(fd, 'accountId')) {
    return { error: 'invalid' };
  }

  let newId = '';
  const touchedItems: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
    if (kind === 'STOCK_PURCHASE') {
      const qty = quantity as number;
      const unit = reqField(fd, 'unit');
      if (!isMeasurementUnit(unit)) throw new Error('invalid-unit');
      const unitCost = unitCostData(money.amount, qty);
      const item = await resolveInventoryItem(tx, fd, user.id, unitCost);
      if (!item) throw new Error('invalid-item');
      const entry = await tx.financeEntry.create({
        data: {
          ...baseEntryData(fd, date, money, 'PURCHASE', payable, payable ? 'PAYABLE' : null),
          accountId: payable ? null : optField(fd, 'accountId') ?? null,
          categoryType: categoryForInventory(item.category),
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
      const entry = await tx.financeEntry.create({
        data: {
          ...baseEntryData(fd, date, money, 'PURCHASE', payable, payable ? 'PAYABLE' : null),
          accountId: payable ? null : optField(fd, 'accountId') ?? null,
          categoryType: 'EQUIPMENT',
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

async function entrySnapshot(tx: Tx, id: string) {
  return tx.financeEntry.findUnique({
    where: { id },
    include: {
      stockMovements: true,
      costLayers: true,
      fixedAsset: true,
      settlements: true,
    },
  });
}

export async function archiveFinanceEntry(id: string, locale: string, active: boolean): Promise<void> {
  const user = await requireOwnerAdminUser();
  if (!user) return;
  const snapshot = await prisma.financeEntry.findUnique({
    where: { id },
    include: { fixedAsset: true },
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
    if (snapshot.fixedAsset) {
      await tx.fixedAsset.update({
        where: { id: snapshot.fixedAsset.id },
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
