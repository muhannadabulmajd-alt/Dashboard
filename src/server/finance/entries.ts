'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { FINANCE_TYPES, CURRENCIES, OBLIGATION_KINDS, EXPENSE_CATEGORY_TYPES } from '@/lib/enums';
import { toMinor, convertToIqd } from '@/lib/money';
import { getUsdToIqd } from '@/server/settings';
import type { TrustedCommandContext } from '@/server/commands/actor-context';
import {
  requireCap,
  resolveCommandActor,
  audit,
  reqField,
  optField,
  type ActionState,
  type CommandCommitHook,
  type CommandPreconditionHook,
} from '@/server/records/shared';
import { syncAllocatedAssetTotals } from '@/server/finance/asset-allocations';
import {
  captureLayerBaseCosts,
  syncLayerLandedCosts,
} from '@/server/finance/landed-costs';
import { syncActiveCost } from '@/server/inventory/fifo';
import type { Prisma } from '@prisma/client';

const HUB = '/[locale]/(dashboard)/finance';
const LIST = '/[locale]/(dashboard)/finance/ledger';
const SHAREHOLDERS = '/[locale]/(dashboard)/finance/shareholders';
const CAP = 'manage:finance' as const;
const entryAuditSelect = {
  date: true,
  type: true,
  recordClass: true,
  amount: true,
  currency: true,
  origCurrency: true,
  origAmount: true,
  fxRate: true,
  obligation: true,
  obligationKind: true,
  dueDate: true,
  accountId: true,
  toAccountId: true,
  partyId: true,
  categoryType: true,
  paymentMethod: true,
  settlesId: true,
  branchId: true,
  orderId: true,
  description: true,
  reference: true,
  attachmentUrl: true,
} as const;

const schema = z.object({
  type: z.enum(FINANCE_TYPES),
  amount: z.coerce.number().positive(), // major units; converted to minor on save
  currency: z.enum(CURRENCIES), // payment currency; the stored entry is always IQD
  rate: z.coerce.number().positive().optional(), // IQD per $1, used only when paid in USD
  date: z.coerce.date(),
  accountId: z.string().optional(),
  toAccountId: z.string().optional(),
  partyId: z.string().optional(),
  categoryType: z.enum(EXPENSE_CATEGORY_TYPES).optional(),
  obligationKind: z.enum(OBLIGATION_KINDS).optional(),
  dueDate: z.coerce.date().optional(),
  branchId: z.string().optional(),
  description: z.string().optional(),
  reference: z.string().optional(),
  attachmentUrl: z.string().optional(),
  settlesId: z.string().optional(),
});

type Parsed = z.infer<typeof schema>;

function parse(fd: FormData) {
  const obligation = reqField(fd, 'obligation') === 'yes';
  const res = schema.safeParse({
    type: reqField(fd, 'type'),
    amount: reqField(fd, 'amount'),
    currency: reqField(fd, 'currency'),
    rate: optField(fd, 'rate'),
    date: reqField(fd, 'date'),
    accountId: optField(fd, 'accountId'),
    toAccountId: optField(fd, 'toAccountId'),
    partyId: optField(fd, 'partyId'),
    categoryType: optField(fd, 'categoryType'),
    obligationKind: optField(fd, 'obligationKind'),
    dueDate: optField(fd, 'dueDate'),
    branchId: optField(fd, 'branchId'),
    description: optField(fd, 'description'),
    reference: optField(fd, 'reference'),
    attachmentUrl: optField(fd, 'attachmentUrl'),
    settlesId: optField(fd, 'settlesId'),
  });
  return { obligation, res };
}

/** Validate the type/obligation/account combination and shape the row. */
function toData(p: Parsed, obligation: boolean, fallbackRate: number) {
  if (obligation) {
    if (!p.obligationKind) return null; // a due needs payable/receivable
  } else if (p.type === 'TRANSFER') {
    if (!p.accountId || !p.toAccountId || p.accountId === p.toAccountId) return null;
  } else if (!p.accountId) {
    return null; // a cash movement needs an account
  }
  // Everything is stored in IQD. A USD payment is converted at the entry's rate
  // (falling back to the configured rate), keeping the original for the record.
  const payMinor = toMinor(p.amount, p.currency);
  const usd = p.currency === 'USD';
  const rate = usd ? Math.round(p.rate ?? fallbackRate) : null;
  return {
    date: p.date,
    type: p.type,
    recordClass: p.type === 'EXPENSE' ? ('EXPENSE' as const) : p.type === 'PURCHASE' ? ('PURCHASE' as const) : null,
    amount: usd ? convertToIqd(payMinor, 'USD', rate as number) : payMinor,
    currency: 'IQD' as const,
    origCurrency: usd ? ('USD' as const) : null,
    origAmount: usd ? payMinor : null,
    fxRate: rate,
    obligation,
    obligationKind: obligation ? (p.obligationKind ?? null) : null,
    dueDate: obligation ? (p.dueDate ?? null) : null,
    accountId: obligation ? null : (p.accountId ?? null),
    toAccountId: !obligation && p.type === 'TRANSFER' ? (p.toAccountId ?? null) : null,
    partyId: p.partyId ?? null,
    categoryType: p.type === 'EXPENSE' || p.type === 'PURCHASE' ? (p.categoryType ?? null) : null,
    settlesId: p.settlesId ?? null,
    branchId: p.branchId ?? null,
    description: p.description ?? null,
    reference: p.reference ?? null,
    attachmentUrl: p.attachmentUrl ?? null,
  };
}

type AuditScalar = string | number | boolean | null;
type EntryData = Exclude<ReturnType<typeof toData>, null>;

async function validateCapitalParty(data: EntryData): Promise<boolean> {
  if (data.type !== 'CAPITAL_IN' && data.type !== 'DRAWING') return true;
  if (!data.partyId) return false;
  const party = await prisma.party.findUnique({
    where: { id: data.partyId },
    select: { type: true, isActive: true },
  });
  return party?.type === 'SHAREHOLDER' && party.isActive;
}

function proportionalIntegers(total: number, weights: number[]): number[] {
  const weightTotal = weights.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!weights.length) return [];
  if (weightTotal <= 0) return weights.map((_, index) => (index === weights.length - 1 ? total : 0));
  const exact = weights.map((value) => (Math.max(0, value) * total) / weightTotal);
  const result = exact.map(Math.floor);
  const remainder = total - result.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remainder; i++) result[order[i % order.length].index] += 1;
  return result;
}

async function updateLinkedRecords(
  tx: Prisma.TransactionClient,
  id: string,
  data: ReturnType<typeof toData> extends infer T ? Exclude<T, null> : never,
  userId: string,
): Promise<string[]> {
  const linked = await tx.financeEntry.findUnique({
    where: { id },
    select: {
      amount: true,
      ledgerLines: {
        orderBy: { lineNo: 'asc' },
        select: {
          id: true,
          lineTotal: true,
          discountAmount: true,
          extraAmount: true,
          quantity: true,
          unitCost: true,
          inventoryItemId: true,
          fixedAssetCostAllocations: {
            select: { id: true, fixedAssetId: true, amount: true },
          },
          landedCostAllocations: {
            select: { id: true, amount: true, costLayerId: true },
          },
        },
      },
      fixedAssets: { select: { id: true, quantity: true, totalCost: true } },
    },
  });
  if (!linked) return [];
  const touchedAssetIds = new Set<string>();
  const touchedInventoryItemIds = new Set(
    linked.ledgerLines
      .map((line) => line.inventoryItemId)
      .filter((value): value is string => Boolean(value)),
  );
  const layerBaseCosts = await captureLayerBaseCosts(
    tx,
    linked.ledgerLines.flatMap((line) =>
      line.landedCostAllocations
        .map((allocation) => allocation.costLayerId)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  if (linked.ledgerLines.length) {
    const totals = proportionalIntegers(data.amount, linked.ledgerLines.map((line) => line.lineTotal));
    const discounts = proportionalIntegers(
      Math.round(linked.ledgerLines.reduce((sum, line) => sum + line.discountAmount, 0) * data.amount / linked.amount),
      linked.ledgerLines.map((line) => line.discountAmount),
    );
    const extras = proportionalIntegers(
      Math.round(linked.ledgerLines.reduce((sum, line) => sum + line.extraAmount, 0) * data.amount / linked.amount),
      linked.ledgerLines.map((line) => line.extraAmount),
    );
    for (let index = 0; index < linked.ledgerLines.length; index++) {
      const line = linked.ledgerLines[index];
      const quantity = Number(line.quantity);
      const baseUnitCost = Number(line.unitCost) * data.amount / linked.amount;
      const landedUnitCost = quantity > 0 ? totals[index] / quantity : 0;
      await tx.ledgerEntryLine.update({
        where: { id: line.id },
        data: {
          lineTotal: totals[index],
          discountAmount: discounts[index],
          extraAmount: extras[index],
          unitCost: baseUnitCost.toFixed(3),
          landedUnitCost: landedUnitCost.toFixed(3),
          branchId: data.branchId,
        },
      });
      const fixedAssetAllocationTotals = proportionalIntegers(
        totals[index],
        line.fixedAssetCostAllocations.map((allocation) => allocation.amount),
      );
      for (const [allocationIndex, allocation] of line.fixedAssetCostAllocations.entries()) {
        await tx.fixedAssetCostAllocation.update({
          where: { id: allocation.id },
          data: { amount: fixedAssetAllocationTotals[allocationIndex] },
        });
        touchedAssetIds.add(allocation.fixedAssetId);
      }
      const landedAllocationTotals = proportionalIntegers(
        totals[index],
        line.landedCostAllocations.map((allocation) => allocation.amount),
      );
      for (const [allocationIndex, allocation] of line.landedCostAllocations.entries()) {
        await tx.inventoryLandedCostAllocation.update({
          where: { id: allocation.id },
          data: { amount: landedAllocationTotals[allocationIndex] },
        });
      }
      if (line.inventoryItemId) {
        await tx.inventoryCostLayer.updateMany({
          where: { financeEntryId: id, inventoryItemId: line.inventoryItemId },
          data: { unitCost: landedUnitCost.toFixed(3), receivedAt: data.date },
        });
        await tx.stockMovement.updateMany({
          where: { financeEntryId: id, inventoryItemId: line.inventoryItemId },
          data: { occurredAt: data.date, branchId: data.branchId },
        });
      }
    }
  }

  if (touchedAssetIds.size) {
    await tx.fixedAsset.updateMany({
      where: { id: { in: [...touchedAssetIds] } },
      data: {
        purchaseDate: data.date,
        partyId: data.partyId,
        branchId: data.branchId,
      },
    });
    await syncAllocatedAssetTotals(tx, touchedAssetIds, {
      userId,
      reason: `Source finance record ${id} updated`,
    });
  }

  const legacyAssets = linked.fixedAssets.filter((asset) => !touchedAssetIds.has(asset.id));
  if (legacyAssets.length) {
    const totals = proportionalIntegers(data.amount, legacyAssets.map((asset) => asset.totalCost));
    for (let index = 0; index < legacyAssets.length; index++) {
      const asset = legacyAssets[index];
      const quantity = Number(asset.quantity);
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: {
          totalCost: totals[index],
          unitCost: (totals[index] / quantity).toFixed(3),
          purchaseDate: data.date,
          partyId: data.partyId,
          branchId: data.branchId,
        },
      });
    }
  }
  const recalculatedItems = await syncLayerLandedCosts(tx, layerBaseCosts);
  for (const itemId of recalculatedItems) touchedInventoryItemIds.add(itemId);
  return [...touchedInventoryItemIds];
}

function auditValue(value: unknown): AuditScalar {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

function auditEntrySnapshot(data: object): Prisma.InputJsonObject {
  const row = data as Record<string, unknown>;
  return Object.fromEntries(Object.keys(entryAuditSelect).map((key) => [key, auditValue(row[key])]));
}

function changedEntryFields(before: object | null, after: object): Prisma.InputJsonObject {
  if (!before) return {};
  const beforeRow = before as Record<string, unknown>;
  const afterRow = after as Record<string, unknown>;
  const changes: Record<string, Prisma.InputJsonValue> = {};
  for (const key of Object.keys(entryAuditSelect)) {
    if (!(key in afterRow)) continue;
    const oldValue = auditValue(beforeRow[key]);
    const nextValue = auditValue(afterRow[key]);
    if (oldValue !== nextValue) changes[key] = { old: oldValue, next: nextValue };
  }
  return changes;
}

function genericSpendClassification(data: EntryData) {
  if (data.type === 'EXPENSE') {
    return {
      itemType: 'EXPENSE' as const,
      spendTreatment: 'OPEX' as const,
      classificationStatus: 'CONFIRMED' as const,
      classificationNote: 'Recorded as operating spending from the quick finance form.',
    };
  }
  if (data.categoryType === 'GREEN_COFFEE' || data.categoryType === 'PACKAGING') {
    return {
      itemType: 'INVENTORY' as const,
      spendTreatment: 'INVENTORY' as const,
      classificationStatus: 'NEEDS_REVIEW' as const,
      classificationNote: 'Inventory purchase awaiting allocation to a stock item.',
    };
  }
  return {
    itemType: 'OTHER' as const,
    spendTreatment: 'REVIEW' as const,
    classificationStatus: 'NEEDS_REVIEW' as const,
    classificationNote: 'Purchase needs Owner/Admin classification as inventory, asset, or operating spending.',
  };
}

export async function createEntry(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const { obligation, res } = parse(fd);
  if (!res.success) return { error: 'invalid' };
  const data = toData(res.data, obligation, await getUsdToIqd());
  if (!data) return { error: 'invalid' };
  if (!(await validateCapitalParty(data))) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.financeEntry.create({ data: { ...data, createdById: user.id } });
    if (data.type !== 'EXPENSE' && data.type !== 'PURCHASE') return created;

    const classification = genericSpendClassification(data);
    const line = await tx.ledgerEntryLine.create({
      data: {
        financeEntryId: created.id,
        lineNo: 1,
        itemType: classification.itemType,
        itemName: data.description ?? data.reference ?? 'Recorded spending',
        categoryType: data.categoryType,
        unit: 'unit',
        quantity: 1,
        unitCost: data.amount,
        landedUnitCost: data.amount,
        lineTotal: data.amount,
        branchId: data.branchId,
        spendTreatment: classification.spendTreatment,
        classificationStatus: classification.classificationStatus,
        classificationSource: 'quick-finance-form',
        classificationNote: classification.classificationNote,
      },
      select: { id: true },
    });
    if (classification.spendTreatment === 'INVENTORY') {
      await tx.inventoryLandedCostAllocation.create({
        data: {
          importKey: `LANDED:PENDING:${line.id}`,
          financeEntryId: created.id,
          ledgerLineId: line.id,
          amount: data.amount,
          notes: classification.classificationNote,
        },
      });
    }
    if (classification.spendTreatment === 'REVIEW') {
      await tx.financeEntry.update({
        where: { id: created.id },
        data: { type: 'EXPENSE', recordClass: 'EXPENSE' },
      });
    }
    return created;
  });
  await audit(user.id, 'CREATE', 'FinanceEntry', { id: row.id, ...auditEntrySnapshot(data) });
  revalidatePath(HUB, 'page');
  revalidatePath(LIST, 'page');
  revalidatePath(SHAREHOLDERS, 'page');
  redirect(`/${locale}/finance/ledger/${row.id}`);
}

export async function updateEntry(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const { obligation, res } = parse(fd);
  if (!res.success) return { error: 'invalid' };
  const data = toData(res.data, obligation, await getUsdToIqd());
  if (!data) return { error: 'invalid' };
  if (!(await validateCapitalParty(data))) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  const before = await prisma.financeEntry.findUnique({ where: { id }, select: entryAuditSelect });
  if (!before) return { error: 'invalid' };
  await prisma.$transaction(async (tx) => {
    await tx.financeEntry.update({ where: { id }, data });
    const linkedItems = await updateLinkedRecords(tx, id, data, user.id);
    for (const itemId of linkedItems) await syncActiveCost(itemId, tx);
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'UPDATE',
        entity: 'FinanceEntry',
        entityId: id,
        metadata: {
          reason: optField(fd, 'changeReason') ?? null,
          changes: changedEntryFields(before, data),
        },
      },
    });
  });
  revalidatePath(HUB, 'page');
  revalidatePath(LIST, 'page');
  revalidatePath(SHAREHOLDERS, 'page');
  redirect(`/${locale}/finance/ledger/${id}`);
}

const FinanceReversalCommandSchema = z.object({
  entryId: z.string().min(1),
  reason: z.string().trim().min(3),
}).strict();

export type FinanceReversalCommandInput = z.input<typeof FinanceReversalCommandSchema>;

export async function reverseFinanceEntryFromInput(
  rawInput: FinanceReversalCommandInput,
  options: {
    actorContext?: TrustedCommandContext;
    precondition?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{
      recordId: string;
      reversalId: string;
      reason: string;
    }>;
  } = {},
) {
  const user = await resolveCommandActor(CAP, options.actorContext);
  if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
    throw new Error('forbidden');
  }
  const { entryId: id, reason } = FinanceReversalCommandSchema.parse(rawInput);

  return prisma.$transaction(async (tx) => {
    await options.precondition?.(tx);
    const entry = await tx.financeEntry.findUnique({
      where: { id },
      include: {
        settlements: { where: { archivedAt: null, reversedAt: null, reversalOfId: null }, select: { id: true } },
        fixedAssets: { select: { id: true } },
        stockMovements: { select: { inventoryItemId: true } },
        costLayers: { select: { inventoryItemId: true } },
        ledgerLines: {
          include: {
            fixedAssetCostAllocations: { select: { fixedAssetId: true } },
            landedCostAllocations: { select: { costLayerId: true, inventoryItemId: true } },
          },
        },
      },
    });
    if (!entry || entry.importKey || entry.reversedAt || entry.reversalOfId) {
      throw new Error('entry_not_reversible');
    }
    if (entry.obligation && entry.settlements.length > 0) {
      throw new Error('entry_has_settlements');
    }
    const touchedItems = new Set<string>([
      ...entry.stockMovements.map((movement) => movement.inventoryItemId),
      ...entry.costLayers.map((layer) => layer.inventoryItemId),
      ...entry.ledgerLines.flatMap((line) =>
        line.landedCostAllocations
          .map((allocation) => allocation.inventoryItemId)
          .filter((value): value is string => Boolean(value)),
      ),
    ]);
    const layerBaseCosts = await captureLayerBaseCosts(
      tx,
      entry.ledgerLines.flatMap((line) =>
        line.landedCostAllocations
          .map((allocation) => allocation.costLayerId)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    await tx.financeEntry.update({
      where: { id },
      data: {
        reversedAt: new Date(),
        reversedById: user.id,
        reversalReason: reason,
      },
    });
    const reversal = await tx.financeEntry.create({
      data: {
        date: new Date(),
        type: entry.type,
        amount: entry.amount,
        currency: entry.currency,
        origCurrency: entry.origCurrency,
        origAmount: entry.origAmount,
        fxRate: entry.fxRate,
        obligation: entry.obligation,
        obligationKind: entry.obligationKind,
        dueDate: entry.dueDate,
        accountId: entry.accountId,
        toAccountId: entry.toAccountId,
        partyId: entry.partyId,
        categoryType: entry.categoryType,
        settlesId: entry.settlesId,
        branchId: entry.branchId,
        orderId: entry.orderId,
        reference: entry.reference,
        attachmentUrl: entry.attachmentUrl,
        description: `Reversal marker for ${entry.reference ?? entry.id}: ${reason}`,
        reversalOfId: entry.id,
        createdById: user.id,
      },
    });
    const allocatedAssetIds = entry.ledgerLines.flatMap((line) =>
      line.fixedAssetCostAllocations.map((allocation) => allocation.fixedAssetId)
    );
    await tx.fixedAsset.updateMany({
      where: {
        id: { in: entry.fixedAssets.map((asset) => asset.id) },
        costAllocations: { none: {} },
      },
      data: {
        isActive: false,
        archivedAt: new Date(),
        archivedById: user.id,
        archiveReason: `Source finance record reversed: ${reason}`,
      },
    });
    await syncAllocatedAssetTotals(tx, allocatedAssetIds, {
      userId: user.id,
      reason: `All source finance records reversed: ${reason}`,
    });
    const recalculatedItems = await syncLayerLandedCosts(tx, layerBaseCosts);
    for (const itemId of recalculatedItems) touchedItems.add(itemId);
    for (const itemId of touchedItems) await syncActiveCost(itemId, tx);
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'REVERSE',
        entity: 'FinanceEntry',
        entityId: id,
        metadata: {
          reason,
          reversed: auditEntrySnapshot(entry),
          related: {
            orderId: entry.orderId,
            importKey: entry.importKey,
            accountId: entry.accountId,
            toAccountId: entry.toAccountId,
            partyId: entry.partyId,
            branchId: entry.branchId,
          },
        },
      },
    });
    const result = { recordId: entry.id, reversalId: reversal.id, reason };
    await options.onCommitted?.(tx, result);
    return result;
  });
}

function revalidateFinanceMutation() {
  revalidatePath(HUB, 'page');
  revalidatePath(LIST, 'page');
  revalidatePath('/[locale]/(dashboard)/finance/dues', 'page');
  revalidatePath(SHAREHOLDERS, 'page');
}

export async function reverseEntry(id: string, locale: string): Promise<void> {
  await reverseFinanceEntryFromInput({ entryId: id, reason: 'Manual reversal' });
  revalidateFinanceMutation();
  redirect(`/${locale}/finance/ledger`);
}

export async function reverseEntryWithReason(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = reqField(fd, 'locale') || 'ar';
  const reason = reqField(fd, 'reason');
  if (reason.length < 3) return { error: 'reason' };
  try {
    await reverseFinanceEntryFromInput({ entryId: id, reason });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'invalid' };
  }
  revalidateFinanceMutation();
  redirect(`/${locale}/finance/ledger`);
}

export async function deleteEntry(id: string, locale: string): Promise<void> {
  await reverseEntry(id, locale);
}

const settleSchema = z.object({
  amount: z.coerce.number().positive(),
  accountId: z.string().min(1),
  paymentMethod: z.string().optional(),
  date: z.coerce.date(),
});

const FinanceSettlementCommandSchema = settleSchema.extend({
  obligationId: z.string().min(1),
});

export type FinanceSettlementCommandInput = z.input<typeof FinanceSettlementCommandSchema>;

export async function settleFinanceEntryFromInput(
  input: FinanceSettlementCommandInput,
  options: {
    actorContext?: TrustedCommandContext;
    precondition?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{
      recordId: string;
      obligationId: string;
      amount: number;
      outstandingBefore: number;
    }>;
  } = {},
) {
  const user = await resolveCommandActor(CAP, options.actorContext);
  if (!user) throw new Error('forbidden');
  const parsed = FinanceSettlementCommandSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    await options.precondition?.(tx);
    const obligation = await tx.financeEntry.findUnique({
      where: { id: parsed.obligationId },
      include: {
        settlements: {
          where: { archivedAt: null, reversedAt: null, reversalOfId: null },
          select: { amount: true },
        },
      },
    });
    if (
      !obligation ||
      obligation.archivedAt ||
      obligation.reversedAt ||
      obligation.reversalOfId ||
      !obligation.obligation ||
      !obligation.obligationKind
    ) {
      throw new Error('obligation_not_found');
    }
    const account = await tx.financeAccount.findFirst({
      where: { id: parsed.accountId, isActive: true },
      select: { id: true, currency: true },
    });
    if (!account || account.currency !== obligation.currency) throw new Error('account_currency');
    const paid = obligation.settlements.reduce((sum, settlement) => sum + settlement.amount, 0);
    const outstanding = Math.max(0, obligation.amount - paid);
    if (outstanding <= 0) throw new Error('obligation_settled');
    const amount = Math.min(toMinor(parsed.amount, obligation.currency), outstanding);
    if (amount <= 0) throw new Error('amount');

    const settlement = await tx.financeEntry.create({
      data: {
        date: parsed.date,
        type: obligation.obligationKind === 'PAYABLE' ? 'PAYMENT_OUT' : 'PAYMENT_IN',
        amount,
        currency: obligation.currency,
        obligation: false,
        accountId: account.id,
        partyId: obligation.partyId,
        paymentMethod: parsed.paymentMethod ?? null,
        settlesId: obligation.id,
        branchId: obligation.branchId,
        orderId: obligation.orderId,
        reference: obligation.reference,
        description: `Settlement for ${obligation.recordKey ?? obligation.reference ?? obligation.id}`,
        createdById: user.id,
      },
    });
    const result = {
      recordId: settlement.id,
      obligationId: obligation.id,
      amount,
      outstandingBefore: outstanding,
    };
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'SETTLE',
        entity: 'FinanceEntry',
        entityId: settlement.id,
        metadata: {
          obligationId: obligation.id,
          amount,
          accountId: account.id,
          paymentMethod: parsed.paymentMethod ?? null,
          partyId: obligation.partyId,
          branchId: obligation.branchId,
          orderId: obligation.orderId,
          date: parsed.date.toISOString(),
          outstandingBefore: outstanding,
          outstandingAfter: outstanding - amount,
        },
      },
    });
    await options.onCommitted?.(tx, result);
    return result;
  });
}

/** Record a (partial) payment that settles a payable/receivable obligation. */
export async function settleEntry(
  obligationId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const r = settleSchema.safeParse({
    amount: reqField(fd, 'amount'),
    accountId: reqField(fd, 'accountId'),
    paymentMethod: optField(fd, 'paymentMethod'),
    date: reqField(fd, 'date'),
  });
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  try {
    await settleFinanceEntryFromInput({ obligationId, ...r.data });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'invalid' };
  }
  revalidatePath(HUB, 'page');
  revalidatePath(LIST, 'page');
  revalidatePath('/[locale]/(dashboard)/finance/dues', 'page');
  revalidatePath(SHAREHOLDERS, 'page');
  redirect(`/${locale}/finance/dues`);
}

/**
 * Set the paying account on imported (PUR:) purchases that have none, matching
 * the account's currency — so cash balances reflect historical spend.
 */
export async function assignImportedAccount(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const accountId = reqField(fd, 'accountId');
  const locale = reqField(fd, 'locale') || 'ar';
  if (!accountId) return { error: 'invalid' };
  const account = await prisma.financeAccount.findUnique({ where: { id: accountId }, select: { currency: true } });
  if (!account) return { error: 'invalid' };
  await prisma.financeEntry.updateMany({
    where: {
      importKey: { startsWith: 'PUR:' },
      currency: account.currency,
      accountId: null,
      obligation: false,
      reversedAt: null,
      reversalOfId: null,
    },
    data: { accountId },
  });
  await audit(user.id, 'ASSIGN_ACCOUNT', 'FinanceEntry', { accountId, currency: account.currency });
  revalidatePath(HUB, 'page');
  revalidatePath(LIST, 'page');
  revalidatePath(SHAREHOLDERS, 'page');
  redirect(`/${locale}/finance/ledger`);
}
